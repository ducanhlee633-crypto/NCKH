"""Test cho search tool DuckDuckGo (agent_tools.web_search) + đấu nối /api/ai/chat.

Chạy:  .venv/bin/python -m pytest test_web_search.py -q
       (fallback: .venv/bin/python -m unittest test_web_search -v)
ddgs được mock hoàn toàn, không gọi mạng thật.
"""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from agent_tools import web_search as ws
from agent_tools.web_search import (
    SearchUnavailableError,
    extract_search_query,
    format_results_for_llm,
    looks_like_search_request,
    score_result,
    search_documents,
)
from auth import get_current_supabase_user
from main import app

FAKE_DOCS = [
    {"title": "Blog cá nhân", "href": "https://blogcanhan.xyz/toan-lop-9", "body": "Ghi chép cá nhân."},
    {"title": "Phương pháp giải phương trình bậc 2 lớp 9", "href": "https://vietjack.com/toan-lop-9/phuong-trinh-bac-2.jsp", "body": "Lý thuyết + bài tập."},
    {"title": "Math docs", "href": "https://example.com/tailieu.PDF", "body": "File PDF tổng hợp."},
]


def _completion(content=None, tool_calls=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=tool_calls))])


def _search_tool_call(query="định lý Vi-ét", max_results=3):
    return SimpleNamespace(
        id="call_1",
        function=SimpleNamespace(
            name="search_documents",
            arguments=json.dumps({"query": query, "max_results": max_results}),
        ),
    )


class TestScoreResult(unittest.TestCase):
    def test_pdf_beats_plain_page(self):
        self.assertGreater(score_result("https://x.com/a.pdf", "docs"), score_result("https://x.com/a", "docs"))

    def test_edu_domain_boost(self):
        self.assertGreater(
            score_result("https://vietjack.com/toan-9", "toán"),
            score_result("https://random-blog.xyz/toan-9", "toán"),
        )

    def test_vietnamese_title_bonus(self):
        url = "https://example.com/bai-1"
        self.assertGreater(score_result(url, "Phương trình bậc hai"), score_result(url, "Quadratic equation"))


class TestIntent(unittest.TestCase):
    def test_keywords_detected(self):
        for text in [
            "tìm tài liệu về este",
            "Bạn ơi tìm giúp mình đề toán lớp 8",
            "xin tài liệu ôn thi vào 10",
            "tìm đề thi học kỳ 1 Văn 10",
            "search tài liệu hóa 10",
        ]:
            self.assertTrue(looks_like_search_request(text), text)

    def test_plain_questions_ignored(self):
        for text in ["", "   ", "giải thích định lý Vi-ét", "research về este", "đề thi này khó quá"]:
            self.assertFalse(looks_like_search_request(text), text)

    def test_extract_query(self):
        self.assertEqual(extract_search_query("tìm tài liệu về este giúp mình nhé"), "este")
        self.assertEqual(extract_search_query("Bạn ơi tìm giúp mình đề thi toán lớp 8"), "đề thi toán lớp 8")
        self.assertEqual(extract_search_query("tìm đề thi học kỳ 1 môn Văn lớp 10 với ạ"), "đề thi học kỳ 1 môn Văn lớp 10")
        self.assertEqual(extract_search_query("tìm bài tập este nhé"), "bài tập este")
        self.assertEqual(extract_search_query("cho mình xin link tài liệu este với"), "este")

    def test_extract_falls_back_to_full_sentence_without_topic(self):
        # Không nêu chủ đề -> giữ nguyên câu để DDG tự bắt chủ đề ở nửa đầu.
        self.assertEqual(
            extract_search_query("Mình muốn tìm hiểu về este, tìm tài liệu giúp mình"),
            "Mình muốn tìm hiểu về este, tìm tài liệu giúp mình",
        )


class TestSearchDocuments(unittest.TestCase):
    def test_ranking_prefers_study_docs(self):
        with patch("ddgs.DDGS") as mock_ddgs:
            mock_ddgs.return_value.text.return_value = FAKE_DOCS
            docs = search_documents("phương trình bậc 2", max_results=5)
        self.assertEqual(
            [doc["url"] for doc in docs],
            [
                "https://vietjack.com/toan-lop-9/phuong-trinh-bac-2.jsp",
                "https://example.com/tailieu.PDF",
                "https://blogcanhan.xyz/toan-lop-9",
            ],
        )

    def test_dedupe_and_limit(self):
        dupes = [
            {"title": "A", "href": "https://vietjack.com/x/", "body": ""},
            {"title": "A copy", "href": "https://VIETJACK.com/x", "body": ""},
        ]
        with patch("ddgs.DDGS") as mock_ddgs:
            mock_ddgs.return_value.text.return_value = dupes
            docs = search_documents("x", max_results=1)
        self.assertEqual(len(docs), 1)

    def test_empty_query_rejected(self):
        with self.assertRaises(ValueError):
            search_documents("   ")

    def test_network_error_wrapped(self):
        with patch("ddgs.DDGS") as mock_ddgs:
            mock_ddgs.return_value.text.side_effect = Exception("202 Ratelimit")
            with self.assertRaises(SearchUnavailableError):
                search_documents("este")


class TestToolSpecAndFormat(unittest.TestCase):
    def test_tool_spec_shape(self):
        self.assertEqual(ws.TOOL_SPEC["function"]["name"], "search_documents")
        self.assertEqual(ws.TOOL_SPEC["function"]["parameters"]["required"], ["query"])

    def test_format_empty(self):
        self.assertEqual(format_results_for_llm([], "este"), "")
        self.assertEqual(format_results_for_llm(None), "")

    def test_format_lists_links(self):
        text = format_results_for_llm(
            [{"title": "T", "url": "https://vietjack.com/x", "snippet": "Mô tả"}],
            "este",
        )
        self.assertIn("https://vietjack.com/x", text)
        self.assertIn("Link:", text)


class TestChatSearchFlow(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_current_supabase_user] = lambda: SimpleNamespace(id="user-1", email="a@b.c")
        self.client = TestClient(app)
        self.settings = patch(
            "routers.ai.get_settings",
            return_value=SimpleNamespace(
                openrouter_api_key="test-key",
                openrouter_model="test-model",
                openrouter_site_url=None,
                openrouter_app_name=None,
            ),
        ).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(app.dependency_overrides.clear)

    def _mock_openai(self, *completions):
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = list(completions)
        patcher = patch("openai.OpenAI", return_value=mock_client)
        patcher.start()
        self.addCleanup(patcher.stop)
        return mock_client

    def test_keyword_request_searches_first(self):
        mock_client = self._mock_openai(_completion(content="Tóm tắt + link"))
        with patch("routers.ai.search_documents", return_value=[
            {"title": "Este cơ bản", "url": "https://vietjack.com/este", "snippet": "Lý thuyết este."},
        ]) as mock_search:
            response = self.client.post("/api/ai/chat", json={"message": "tìm tài liệu về este giúp mình nhé"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Tóm tắt", response.json()["reply"])
        mock_search.assert_called_once_with("este", max_results=5)
        # Kết quả search được nhồi vào prompt lượt gọi model duy nhất.
        sent_messages = mock_client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("https://vietjack.com/este", sent_messages[-1]["content"])

    def test_model_tool_call_triggers_search(self):
        mock_client = self._mock_openai(
            _completion(tool_calls=[_search_tool_call()]),
            _completion(content="Đây là tài liệu Vi-ét + link"),
        )
        with patch("routers.ai.search_documents", return_value=[
            {"title": "Vi-ét", "url": "https://loigiaihay.com/vi-et", "snippet": "Hệ thức Vi-ét."},
        ]) as mock_search:
            response = self.client.post("/api/ai/chat", json={"message": "định lý Vi-ét phát biểu thế nào"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Vi-ét", response.json()["reply"])
        mock_search.assert_called_once_with("định lý Vi-ét", max_results=3)
        # Lượt 2 gửi tool result đúng format OpenAI.
        second_call = mock_client.chat.completions.create.call_args_list[1].kwargs
        tool_message = second_call["messages"][-1]
        self.assertEqual(tool_message["role"], "tool")
        self.assertEqual(tool_message["tool_call_id"], "call_1")
        self.assertIn("https://loigiaihay.com/vi-et", tool_message["content"])

    def test_search_failure_falls_back_to_plain_answer(self):
        mock_client = self._mock_openai(_completion(content="Trả lời chay"))
        with patch("routers.ai.search_documents", side_effect=SearchUnavailableError("boom")):
            response = self.client.post("/api/ai/chat", json={"message": "tìm tài liệu về este"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], "Trả lời chay")
        mock_client.chat.completions.create.assert_called_once()

    def test_model_without_tool_support_still_answers(self):
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [
            Exception("This endpoint does not support tools"),
            _completion(content="Trả lời thường"),
        ]
        with patch("openai.OpenAI", return_value=mock_client):
            response = self.client.post("/api/ai/chat", json={"message": "este là gì"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["reply"], "Trả lời thường")


if __name__ == "__main__":
    unittest.main()
