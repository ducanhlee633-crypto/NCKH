"""Test AI tool generate lộ trình: POST /api/ai/roadmap.

Chạy: python3 -m pytest test_roadmap_ai.py -q (thư mục backend/)
Mock OpenAI + search, không gọi mạng thật.
"""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from auth import get_current_supabase_user
from main import app


def _completion(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=None))])


FAKE_REPLY = """{
  "stages": [
    {
      "title": "Nền tảng phương trình bậc 2",
      "goal": "Nắm định nghĩa, công thức nghiệm dựa trên tài liệu SGK VietJack.",
      "materials": [{"label": "Bài giảng", "url": "https://vietjack.com/toan-9/bai-giang"}],
      "checkpoint": "5 câu trắc nghiệm 15 phút, đạt 4/5 mới sang chặng sau.",
      "lessons": [
        {"title": "Ôn hằng đẳng thức", "focus": "Xem ví dụ 1-3 ở link rồi làm 10 câu", "material_url": "https://vietjack.com/toan-9/bai-giang"},
        {"title": "Công thức nghiệm", "focus": "Học công thức delta ở link rồi làm 8 câu", "material_url": "https://vietjack.com/toan-9/bai-giang"}
      ]
    },
    {
      "title": "Luyện đề tổng hợp",
      "goal": "Giải đề 45 phút dựa trên bộ đề Tuyensinh247.",
      "materials": [{"label": "Bộ đề", "url": "https://tuyensinh247.com/de-toan-9"}],
      "checkpoint": "1 đề 45 phút, đạt 7/10 mới xong.",
      "lessons": [
        {"title": "Đề 1 bấm giờ", "focus": "Làm đề 1 trong link, tự chấm", "material_url": "https://tuyensinh247.com/de-toan-9"},
        {"title": "Chữa lỗi sai", "focus": "Chữa 3 câu sai nhất trong đề 1", "material_url": "https://tuyensinh247.com/de-toan-9"}
      ]
    }
  ]
}"""


class TestRoadmapAi(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_current_supabase_user] = lambda: SimpleNamespace(id="user-1", email="a@b.c")
        self.client = TestClient(app)
        settings = SimpleNamespace(
            openrouter_api_key="test-key",
            openrouter_model="test-model",
            openrouter_site_url=None,
            openrouter_app_name=None,
        )
        self._settings = patch("routers.roadmap_ai.get_settings", return_value=settings)
        self._settings.start()
        self.addCleanup(patch.stopall)
        self.addCleanup(app.dependency_overrides.clear)

    def _mock(self, reply=FAKE_REPLY, materials=None):
        if materials is None:
            materials = [
                {"title": "Bài giảng", "url": "https://vietjack.com/toan-9/bai-giang", "snippet": ""},
                {"title": "Bộ đề", "url": "https://tuyensinh247.com/de-toan-9", "snippet": ""},
            ]
        search = patch("routers.roadmap_ai.search_documents", side_effect=[materials[:1], materials[1:], materials])
        search.start()
        self.addCleanup(search.stop)
        mock_client = MagicMock()
        mock_client.chat.completions.create.return_value = _completion(reply)
        opener = patch("openai.OpenAI", return_value=mock_client)
        opener.start()
        self.addCleanup(opener.stop)
        return mock_client

    def test_generate_ok_keeps_total_and_real_links(self):
        self._mock()
        response = self.client.post("/api/ai/roadmap", json={
            "subject": "Toán",
            "context": "Mất gốc phương trình bậc 2, mục tiêu 8 điểm",
            "totalSessions": 4,
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(body["stages"]), 2)
        total = sum(len(stage["lessons"]) for stage in body["stages"])
        self.assertEqual(total, 4)
        # Link phải thuộc allowed (search thật), không bịa.
        urls = {m["url"] for s in body["stages"] for m in s["materials"]}
        self.assertTrue(urls <= {"https://vietjack.com/toan-9/bai-giang", "https://tuyensinh247.com/de-toan-9"})
        for stage in body["stages"]:
            self.assertTrue(stage["title"] and stage["checkpoint"])
            for lesson in stage["lessons"]:
                self.assertTrue(lesson["title"])
                self.assertIn(lesson["material_url"], urls | {""})

    def test_fabricated_url_removed_without_random_replacement(self):
        bad = FAKE_REPLY.replace("https://vietjack.com/toan-9/bai-giang", "https://bia-dat.com/khong-co-that")
        self._mock(reply=bad)
        response = self.client.post("/api/ai/roadmap", json={
            "subject": "Toán", "context": "Ôn thi học kỳ", "totalSessions": 4,
        })
        self.assertEqual(response.status_code, 200, response.text)
        text = response.text
        self.assertNotIn("bia-dat.com", text)
        self.assertEqual(response.json()["stages"][0]["lessons"][0]["material_url"], "")
        self.assertTrue(response.json()["warnings"])

    def test_requires_auth(self):
        app.dependency_overrides.clear()
        client = TestClient(app, raise_server_exceptions=False)
        # Không token -> 401 (auth bearer).
        response = client.post("/api/ai/roadmap", json={
            "subject": "Toán", "context": "Ôn thi", "totalSessions": 4,
        })
        self.assertIn(response.status_code, (401, 403))

    def test_validation(self):
        self._mock()
        bad = self.client.post("/api/ai/roadmap", json={"subject": "", "context": "x", "totalSessions": 4})
        self.assertEqual(bad.status_code, 422)
        over = self.client.post("/api/ai/roadmap", json={"subject": "Toán", "context": "x", "totalSessions": 999})
        self.assertEqual(over.status_code, 422)

    def test_bad_json_from_model_is_502(self):
        self._mock(reply="xin chào, không phải json")
        response = self.client.post("/api/ai/roadmap", json={
            "subject": "Toán", "context": "Ôn thi", "totalSessions": 4,
        })
        self.assertEqual(response.status_code, 502)

    def post(self, **overrides):
        return self.client.post("/api/ai/roadmap", json={
            "subject": "Toán", "context": "Ôn phương trình bậc hai", "totalSessions": 4, **overrides,
        })

    def test_incomplete_plan_retried_without_padding(self):
        client = self._mock()
        incomplete = json.loads(FAKE_REPLY)
        incomplete["stages"][-1]["lessons"].pop()
        client.chat.completions.create.side_effect = [_completion(json.dumps(incomplete)), _completion(FAKE_REPLY)]
        response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(client.chat.completions.create.call_count, 2)
        self.assertEqual(response.json()["stages"][-1]["lessons"][-1]["title"], "Chữa lỗi sai")

    def test_missing_extra_duplicate_and_malformed_lessons_rejected(self):
        client = self._mock()
        for bad in (None, {}, [None], [], [{"title": "a", "focus": "b"}]):
            with self.subTest(bad=bad):
                reply = json.loads(FAKE_REPLY)
                reply["stages"][0]["lessons"] = bad
                client.chat.completions.create.return_value = _completion(json.dumps(reply))
                self.assertEqual(self.post().status_code, 502)
        duplicate = json.loads(FAKE_REPLY)
        duplicate["stages"][0]["lessons"][1] = duplicate["stages"][0]["lessons"][0]
        client.chat.completions.create.return_value = _completion(json.dumps(duplicate))
        self.assertEqual(self.post().status_code, 502)
        client.chat.completions.create.return_value = _completion(FAKE_REPLY)
        self.assertEqual(self.post(totalSessions=3).status_code, 502)

    def test_profile_goals_dates_and_notes_reach_model(self):
        client = self._mock()
        response = self.post(learnerProfile={"grade": 9, "level": "foundation", "currentScore": 4,
            "targetScore": 8, "weakTopics": "Viète", "learningStyle": "Trực quan"},
            goalTitle="Thi học kỳ", goalDetails={"targetScore": 8, "deadline": "2026-11-01", "progress": 25},
            startDate="2026-10-05", endDate="2026-10-31", studyDays=[1, 3, 5], sessionsPerWeek=3,
            notes="Cần nghỉ ngắn", duration=30)
        self.assertEqual(response.status_code, 200, response.text)
        payload = json.loads(client.chat.completions.create.call_args.kwargs["messages"][1]["content"])
        self.assertEqual(payload["learnerProfile"]["grade"], 9)
        self.assertEqual(payload["goalDetails"]["targetScore"], 8)
        self.assertEqual(payload["notes"], "Cần nghỉ ngắn")
        self.assertEqual(payload["studyDays"], [1, 3, 5])
        self.assertEqual(payload["duration"], 30)
        self.assertGreater(client.chat.completions.create.call_args.kwargs["max_tokens"], 2500)
        client.close.assert_called_once()

    def test_constraints_reject_invalid_input_before_model_call(self):
        client = self._mock()
        for payload in ({"duration": 0}, {"duration": 241}, {"sessionsPerWeek": 2.5},
                        {"subject": "   "}, {"context": "   "}, {"totalSessions": 0},
                        {"studyDays": [1, 1]}, {"studyDays": []}, {"studyDays": [7]},
                        {"studyDays": [1], "sessionsPerWeek": 2},
                        {"learnerProfile": {"currentScore": 11}},
                        {"startDate": "2026-11-01", "endDate": "2026-10-01"}):
            with self.subTest(payload=payload):
                self.assertEqual(self.post(**payload).status_code, 422)
        client.chat.completions.create.assert_not_called()

    def test_no_search_results_keeps_plan_without_links(self):
        self._mock(materials=[])
        response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertFalse(body["searchUsed"])
        self.assertTrue(body["warnings"])
        self.assertTrue(all(not s["materials"] for s in body["stages"]))
        self.assertTrue(all(not l["material_url"] for s in body["stages"] for l in s["lessons"]))

    def test_single_session_can_be_one_stage(self):
        client = self._mock()
        reply = json.loads(FAKE_REPLY)
        reply["stages"] = reply["stages"][:1]
        reply["stages"][0]["lessons"] = reply["stages"][0]["lessons"][:1]
        client.chat.completions.create.return_value = _completion(json.dumps(reply))
        self.assertEqual(self.post(totalSessions=1).status_code, 200)

    def test_120_sessions_expanded_from_outline_with_exact_order(self):
        client = self._mock()
        outline = [{"title": f"Chặng {i}", "goal": f"Mục tiêu {i}", "checkpoint": "Kiểm tra 10 phút đạt 80%",
                    "materials": [], "session_count": 30} for i in range(4)]
        def respond(**kwargs):
            message = kwargs["messages"][1]["content"]
            mode = json.loads(message.split("\n")[-1])
            if mode.get("mode") == "outline":
                return _completion(json.dumps({"stages": outline}))
            offset = mode["session_offset"]
            return _completion(json.dumps({"lessons": [{"title": f"Buổi {offset + i + 1}",
                "focus": f"Luyện nội dung {offset + i + 1}", "material_url": ""} for i in range(30)]}))
        client.chat.completions.create.side_effect = respond
        response = self.post(totalSessions=120)
        self.assertEqual(response.status_code, 200, response.text)
        lessons = [l["title"] for s in response.json()["stages"] for l in s["lessons"]]
        self.assertEqual(lessons, [f"Buổi {i}" for i in range(1, 121)])
        self.assertEqual(client.chat.completions.create.call_count, 5)

    def test_rate_limit_error_does_not_leak_provider_details(self):
        client = self._mock()
        error = RuntimeError("secret provider details")
        error.status_code = 429
        client.chat.completions.create.side_effect = error
        response = self.post()
        self.assertEqual(response.status_code, 429)
        self.assertNotIn("secret", response.text)
        client.close.assert_called_once()

    def test_truncated_response_is_retried(self):
        client = self._mock()
        truncated = _completion(FAKE_REPLY)
        truncated.choices[0].finish_reason = "length"
        client.chat.completions.create.side_effect = [truncated, _completion(FAKE_REPLY)]
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(client.chat.completions.create.call_count, 2)

    def test_search_preserves_distinct_query_urls_and_snippets(self):
        from routers.roadmap_ai import _collect_materials, _queries_for, LearnerProfile
        found = [{"url": "https://example.org/watch?v=one", "title": "One", "snippet": "Bài một"},
                 {"url": "https://example.org/watch?v=two", "title": "Two", "snippet": "Bài hai"},
                 {"url": "javascript:alert(1)", "title": "Bad"}]
        with patch("routers.roadmap_ai.search_documents", return_value=found):
            materials, used = _collect_materials("Toán", "Ôn tập")
        self.assertTrue(used)
        self.assertEqual(len(materials), 2)
        self.assertEqual(materials[0]["snippet"], "Bài một")
        queries = _queries_for("Toán", "Ôn tập", LearnerProfile(grade=9, weakTopics="Viète"))
        self.assertTrue(all("lớp 9" in q and "Viète" in q for q in queries))


if __name__ == "__main__":
    unittest.main()
