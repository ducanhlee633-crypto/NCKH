import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from supabase_client import get_supabase_admin, get_supabase_anon


def _clear_caches():
    get_supabase_admin.cache_clear()
    get_supabase_anon.cache_clear()


class FakeTable:
    """Giả lập chuỗi query supabase-py cho bảng profiles."""

    def __init__(self, store: dict):
        self.store = store
        self._op = None
        self._values = None
        self._filter = None

    def select(self, *args):
        # supabase-py cho phép .insert(...).select(...) / .update(...).select(...):
        # select lúc này chỉ chọn cột trả về, không đổi loại thao tác.
        if self._op is None:
            self._op = "select"
        return self

    def insert(self, values):
        self._op = "insert"
        self._values = values
        return self

    def update(self, values):
        self._op = "update"
        self._values = values
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, column, value):
        self._filter = (column, value)
        return self

    def limit(self, *args):
        return self

    def execute(self):
        if self._op == "insert":
            row = {
                "id": self._values.get("id", str(uuid4())),
                "username": self._values.get("username"),
                "name": self._values.get("name", ""),
                "nickname": self._values.get("nickname"),
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
            if "duplicate" in str(row["username"] or "") or "duplicate" in str(row["nickname"] or ""):
                raise Exception("duplicate key value violates unique constraint")
            self.store[row["id"]] = row
            return SimpleNamespace(data=[row])
        if self._op == "update":
            column, value = self._filter
            row = self.store.get(value)
            if not row:
                return SimpleNamespace(data=[])
            if "username" in self._values and "duplicate" in str(self._values["username"] or ""):
                raise Exception("duplicate key value violates unique constraint")
            if "nickname" in self._values and "duplicate" in str(self._values["nickname"] or ""):
                raise Exception("duplicate key value violates unique constraint")
            row.update(self._values)
            return SimpleNamespace(data=[row])
        if self._op == "delete":
            column, value = self._filter
            row = self.store.pop(value, None)
            return SimpleNamespace(data=[row] if row else [])
        # select
        if self._filter:
            column, value = self._filter
            row = self.store.get(value)
            return SimpleNamespace(data=[row] if row else [])
        return SimpleNamespace(data=list(self.store.values()))


def _make_admin_mock(store: dict):
    admin = MagicMock()
    admin.table.side_effect = lambda name: FakeTable(store)
    return admin


def _auth_response(user_id: str, email: str):
    user = SimpleNamespace(id=user_id, email=email)
    session = SimpleNamespace(
        access_token="supabase-access-token",
        refresh_token="supabase-refresh-token",
        expires_in=3600,
        user=user,
    )
    return SimpleNamespace(user=user, session=session)


class SupabaseAuthRoutesTest(unittest.TestCase):
    def test_missing_anon_key_reports_configuration_error(self):
        _clear_caches()
        settings = SimpleNamespace(
            supabase_url="https://example.supabase.co",
            supabase_service_role_key="service-key",
            supabase_anon_key=None,
            supabase_jwt_secret=None,
        )
        try:
            with patch("supabase_client.get_settings", return_value=settings):
                client = TestClient(app)
                credentials = {"email": "a@example.com", "password": "password123"}
                response = client.post("/api/auth/login", json=credentials)
                self.assertEqual(response.status_code, 503)
                self.assertIn("SUPABASE_ANON_KEY", response.json()["detail"])
        finally:
            _clear_caches()

    def test_signup_login_me_update_delete(self):
        store: dict = {}
        user_id = str(uuid4())
        email = "hoc.sinh@example.com"
        admin = _make_admin_mock(store)
        admin.auth.get_user.return_value = SimpleNamespace(
            user=SimpleNamespace(id=user_id, email=email)
        )
        anon = MagicMock()
        anon.auth.sign_up.return_value = _auth_response(user_id, email)
        anon.auth.sign_in_with_password.return_value = _auth_response(user_id, email)
        anon.auth.refresh_session.return_value = _auth_response(user_id, email)

        with patch("routers.user.get_supabase_admin", return_value=admin), patch(
            "routers.user.get_supabase_anon", return_value=anon
        ), patch("auth._verify_locally", return_value=None), patch(
            "supabase_client.get_supabase_admin", return_value=admin
        ):
            client = TestClient(app)
            self.assertEqual(client.get("/api/health").json(), {"status": "ok"})

            # Signup tạo cả auth user (qua Supabase Auth) lẫn profile.
            created = client.post(
                "/api/auth/signup",
                json={"email": email, "password": "password123", "name": "Minh Anh", "username": "minhanh"},
            )
            self.assertEqual(created.status_code, 201, created.text)
            body = created.json()
            self.assertEqual(body["access_token"], "supabase-access-token")
            self.assertEqual(body["user"]["email"], email)
            self.assertEqual(body["profile"]["username"], "minhanh")
            self.assertNotIn("password_hash", body["profile"])

            # Login trả session của Supabase Auth.
            logged_in = client.post("/api/auth/login", json={"email": email, "password": "password123"})
            self.assertEqual(logged_in.status_code, 200)
            headers = {"Authorization": "Bearer supabase-access-token"}

            # Không có token -> 401.
            self.assertEqual(client.get("/api/users/me").status_code, 401)
            # Có token -> đọc đúng profile của mình.
            me = client.get("/api/users/me", headers=headers)
            self.assertEqual(me.status_code, 200)
            self.assertEqual(me.json()["id"], user_id)

            # Refresh session.
            refreshed = client.post("/api/auth/refresh", json={"refresh_token": "supabase-refresh-token"})
            self.assertEqual(refreshed.status_code, 200)

            # Update profile của mình.
            updated = client.patch("/api/users/me", json={"name": "Minh Anh Moi"}, headers=headers)
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.json()["name"], "Minh Anh Moi")

            # Username trùng -> 409 (không lộ lỗi DB).
            store["other-id"] = {
                "id": "other-id",
                "username": "duplicate",
                "name": "Khac",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
            conflict = client.patch("/api/users/me", json={"username": "duplicate"}, headers=headers)
            self.assertEqual(conflict.status_code, 409)

            # Sai credentials từ Supabase Auth -> 401.
            anon.auth.sign_in_with_password.side_effect = Exception("Invalid login credentials")
            bad = client.post("/api/auth/login", json={"email": email, "password": "wrong-password"})
            self.assertEqual(bad.status_code, 401)
            anon.auth.sign_in_with_password.side_effect = None

            # Xóa tài khoản.
            deleted = client.delete("/api/users/me", headers=headers)
            self.assertEqual(deleted.status_code, 204)
            admin.auth.admin.delete_user.assert_called_once_with(user_id)

    def test_reset_password_always_accepted_to_prevent_email_enumeration(self):
        anon = MagicMock()
        with patch("routers.user.get_supabase_anon", return_value=anon):
            client = TestClient(app)
            response = client.post("/api/auth/reset-password", json={"email": "a@example.com"})
            self.assertEqual(response.status_code, 202)
            anon.auth.reset_password_email.assert_called_once_with("a@example.com")
            # Supabase lỗi vẫn trả 202 để kẻ xấu không dò được email nào đã đăng ký.
            anon.auth.reset_password_email.side_effect = Exception("boom")
            retry = client.post("/api/auth/reset-password", json={"email": "b@example.com"})
            self.assertEqual(retry.status_code, 202)

    def test_change_password_requires_auth_and_updates_supabase_user(self):
        from uuid import UUID as _UUID

        user_id = uuid4()
        admin = MagicMock()
        with patch("routers.user.get_supabase_admin", return_value=admin), patch(
            "auth._verify_locally", return_value=user_id
        ):
            client = TestClient(app)
            # Không có token -> 401.
            self.assertEqual(client.patch("/api/auth/password", json={"new_password": "new-password-123"}).status_code, 401)
            # Có token -> gọi admin API đổi đúng user.
            changed = client.patch(
                "/api/auth/password",
                json={"new_password": "new-password-123"},
                headers={"Authorization": "Bearer valid-token"},
            )
            self.assertEqual(changed.status_code, 204)
            admin.auth.admin.update_user_by_id.assert_called_once_with(str(user_id), {"password": "new-password-123"})

    def test_removed_endpoints_do_not_leak_user_list(self):        # Audit: endpoint liệt kê toàn bộ users và truy cập theo id đã bị loại bỏ.
        client = TestClient(app)
        self.assertEqual(client.get("/api/users").status_code, 404)
        self.assertEqual(client.get(f"/api/users/{uuid4()}").status_code, 404)


class FakeScheduleTable:
    """Giả lập query supabase-py cho bảng schedule_blocks (hỗ trợ nhiều .eq nối tiếp)."""

    def __init__(self, store: dict):
        self.store = store
        self._op = None
        self._values = None
        self._filters: list = []

    def select(self, *args):
        if self._op is None:
            self._op = "select"
        return self

    def insert(self, values):
        self._op = "insert"
        self._values = dict(values)
        return self

    def update(self, values):
        self._op = "update"
        self._values = dict(values)
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, column, value):
        self._filters.append((column, str(value)))
        return self

    def limit(self, *args):
        return self

    def _match(self, row: dict) -> bool:
        return all(str(row.get(column)) == value for column, value in self._filters)

    def execute(self):
        if self._op == "insert":
            row = {
                "id": str(uuid4()),
                "repeat_days": [],
                "exdates": [],
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
            row.update(self._values)
            self.store[row["id"]] = row
            return SimpleNamespace(data=[row])
        if self._op == "update":
            matched = [row for row in self.store.values() if self._match(row)]
            for row in matched:
                row.update(self._values)
            return SimpleNamespace(data=matched)
        if self._op == "delete":
            matched = [row for row in self.store.values() if self._match(row)]
            for row in matched:
                self.store.pop(row["id"], None)
            return SimpleNamespace(data=matched)
        return SimpleNamespace(data=[row for row in self.store.values() if self._match(row)])


class ScheduleBlocksTest(unittest.TestCase):
    def setUp(self):
        self.store: dict = {}
        self.user_id = uuid4()
        admin = MagicMock()
        admin.table.side_effect = lambda name: FakeScheduleTable(self.store)
        self._patches = [
            patch("routers.schedule.get_supabase_admin", return_value=admin),
            patch("auth._verify_locally", return_value=self.user_id),
        ]
        for entered in self._patches:
            entered.start()
        self.client = TestClient(app)
        self.headers = {"Authorization": "Bearer test-token"}

    def tearDown(self):
        for entered in self._patches:
            entered.stop()

    def test_requires_auth(self):
        self.assertEqual(self.client.get("/api/schedule").status_code, 401)

    def test_full_crud_with_repeat_series(self):
        # Tạo block lẻ.
        single = self.client.post(
            "/api/schedule",
            json={"title": "Toán", "subject": "Toán", "date": "2026-10-05",
                  "start_time": "14:00", "end_time": "15:30"},
            headers=self.headers,
        )
        self.assertEqual(single.status_code, 201, single.text)
        self.assertIsNone(single.json()["repeat_until"])
        single_id = single.json()["id"]

        # Tạo chuỗi hằng tuần, không gửi repeat_until -> mặc định 31/12.
        series = self.client.post(
            "/api/schedule",
            json={"title": "Tiếng Anh", "date": "2026-10-05",
                  "start_time": "08:00", "end_time": "09:00", "repeat": "weekly"},
            headers=self.headers,
        )
        self.assertEqual(series.status_code, 201, series.text)
        self.assertEqual(series.json()["repeat_until"], "2026-12-31")
        series_id = series.json()["id"]

        # Validate lỗi.
        bad_time = self.client.post(
            "/api/schedule",
            json={"title": "X", "date": "2026-10-05", "start_time": "15:00", "end_time": "14:00"},
            headers=self.headers,
        )
        self.assertEqual(bad_time.status_code, 422)
        bad_custom = self.client.post(
            "/api/schedule",
            json={"title": "X", "date": "2026-10-05", "start_time": "14:00",
                  "end_time": "15:00", "repeat": "custom"},
            headers=self.headers,
        )
        self.assertEqual(bad_custom.status_code, 422)
        bad_year = self.client.post(
            "/api/schedule",
            json={"title": "X", "date": "2026-10-05", "start_time": "14:00",
                  "end_time": "15:00", "repeat": "daily", "repeat_until": "2027-01-01"},
            headers=self.headers,
        )
        self.assertEqual(bad_year.status_code, 422)

        # Lọc theo khoảng: tháng 11 chỉ còn chuỗi weekly (block lẻ tháng 10 bị loại).
        november = self.client.get(
            "/api/schedule?from=2026-11-01&to=2026-11-30", headers=self.headers
        )
        self.assertEqual(november.status_code, 200)
        self.assertEqual([row["id"] for row in november.json()], [series_id])

        # Không đọc được block của user khác.
        other_id = str(uuid4())
        self.store[other_id] = {
            "id": other_id, "user_id": "00000000-0000-0000-0000-000000000000",
            "title": "Riêng tư", "subject": None, "date": "2026-10-06",
            "start_time": "10:00", "end_time": "11:00", "tone": "blue", "kind": "study",
            "repeat": "none", "repeat_days": [], "repeat_until": None, "exdates": [],
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
        }
        self.assertEqual(
            self.client.get(f"/api/schedule/{other_id}", headers=self.headers).status_code, 404
        )

        # Sửa cả chuỗi.
        renamed = self.client.put(
            f"/api/schedule/{series_id}", json={"title": "Tiếng Anh (mới)"}, headers=self.headers
        )
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.json()["title"], "Tiếng Anh (mới)")

        # Sửa 1 buổi lẻ: tách thành block mới, chuỗi gốc thêm exdates.
        split = self.client.put(
            f"/api/schedule/{series_id}?scope=single&day=2026-10-12",
            json={"start_time": "09:00", "end_time": "10:00"},
            headers=self.headers,
        )
        self.assertEqual(split.status_code, 200, split.text)
        child = split.json()
        self.assertEqual(child["repeat"], "none")
        self.assertEqual(child["date"], "2026-10-12")
        parent = self.client.get(f"/api/schedule/{series_id}", headers=self.headers).json()
        self.assertIn("2026-10-12", parent["exdates"])

        # Xóa 1 buổi lẻ khác trong chuỗi.
        removed_one = self.client.delete(
            f"/api/schedule/{series_id}?scope=single&day=2026-10-19", headers=self.headers
        )
        self.assertEqual(removed_one.status_code, 200, removed_one.text)
        self.assertIn("2026-10-19", removed_one.json()["exdates"])

        # Xóa cả chuỗi + xóa block lẻ.
        self.assertEqual(
            self.client.delete(f"/api/schedule/{series_id}", headers=self.headers).status_code, 204
        )
        self.assertEqual(
            self.client.get(f"/api/schedule/{series_id}", headers=self.headers).status_code, 404
        )
        self.assertEqual(
            self.client.delete(f"/api/schedule/{single_id}", headers=self.headers).status_code, 204
        )


class SubjectsTest(unittest.TestCase):
    def test_pomodoro_values_match_db_pattern(self):
        import re

        from schema import POMODORO_SUBJECT_PATTERN, POMODORO_SUBJECT_VALUES

        self.assertIn("Tiếng Anh", POMODORO_SUBJECT_VALUES)  # môn chính từng bị thiếu
        for value in POMODORO_SUBJECT_VALUES:
            self.assertRegex(value, POMODORO_SUBJECT_PATTERN, f"{value} phải khớp pattern")
        self.assertNotRegex("Thể dục", re.compile(POMODORO_SUBJECT_PATTERN))

    def test_normalize_subject_aliases(self):
        from subjects import normalize_subject

        self.assertEqual(normalize_subject(" ngữ văn "), "Văn")
        self.assertEqual(normalize_subject("Vật lý"), "Lí")
        self.assertEqual(normalize_subject("Hóa học"), "Hoá")
        self.assertEqual(normalize_subject("TIẾNG ANH"), "Tiếng Anh")
        self.assertEqual(normalize_subject("Khoa học tự nhiên"), "KHTN")
        self.assertEqual(normalize_subject("Thể dục"), "Thể dục")  # tên lạ giữ nguyên
        self.assertEqual(normalize_subject(None), "")

    def test_school_subjects_cover_pomodoro_labels(self):
        from subjects import SCHOOL_SUBJECTS, normalize_subject

        for name in SCHOOL_SUBJECTS:
            canonical = normalize_subject(name)
            self.assertTrue(canonical, f"{name} phải map được về 1 nhãn")


if __name__ == "__main__":
    unittest.main()
