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
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            }
            if "duplicate" in str(row["username"] or ""):
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


if __name__ == "__main__":
    unittest.main()
