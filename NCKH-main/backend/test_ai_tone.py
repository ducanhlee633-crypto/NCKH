"""Test chất giọng AI: 4 system prompt văn phong + đấu nối POST /api/ai/chat.

Chạy:  python3 -m pytest test_ai_tone.py -q   (thư mục backend/)
OpenAI/supabase được mock hoàn toàn, không gọi mạng thật.
"""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from agent_tools.system_prompt import (
    AI_TONE_PROMPTS,
    AI_TONE_VALUES,
    SYSTEM_PROMPT,
    build_chat_messages,
    get_system_prompt,
    get_tone_instruction,
    normalize_ai_tone,
)
from auth import get_current_supabase_user
from main import app

# Từ khóa đặc trưng phải xuất hiện trong đúng khối văn phong của từng tone.
TONE_MARKERS = {
    "cute": "DỄ THƯƠNG, GẦN GŨI",
    "honest": "THẲNG THẮN, THẬT THÀ",
    "funny": "VUI VẺ, HÀI HƯỚC",
    "empathetic": "ĐỒNG CẢM",
}


def _completion(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=None))])


class TestNormalizeAiTone(unittest.TestCase):
    def test_valid_passthrough(self):
        for tone in ("cute", "honest", "funny", "empathetic"):
            self.assertEqual(normalize_ai_tone(tone), tone)

    def test_invalid_falls_back_to_cute(self):
        for bad in (None, "", "  ", "la", "CUTE", "honest!", " cute_x "):
            self.assertEqual(normalize_ai_tone(bad), "cute", repr(bad))


class TestTonePrompts(unittest.TestCase):
    def test_four_distinct_blocks(self):
        self.assertEqual(set(AI_TONE_VALUES), {"cute", "honest", "funny", "empathetic"})
        self.assertEqual(set(AI_TONE_PROMPTS), set(AI_TONE_VALUES))
        blocks = list(AI_TONE_PROMPTS.values())
        self.assertEqual(len(set(blocks)), 4, "4 tone phải có văn phong khác nhau")

    def test_each_block_has_own_marker(self):
        for tone, marker in TONE_MARKERS.items():
            self.assertIn(marker, AI_TONE_PROMPTS[tone])
            for other, other_block in AI_TONE_PROMPTS.items():
                if other != tone:
                    self.assertNotIn(marker, other_block, f"marker {tone} lẫn sang {other}")

    def test_get_tone_instruction_normalizes(self):
        self.assertIn(TONE_MARKERS["funny"], get_tone_instruction("funny"))
        self.assertIn(TONE_MARKERS["cute"], get_tone_instruction("không-tồn-tại"))


class TestGetSystemPrompt(unittest.TestCase):
    def test_no_arg_keeps_legacy_prompt(self):
        self.assertEqual(get_system_prompt(), SYSTEM_PROMPT)

    def test_tone_appends_voice_block(self):
        for tone, marker in TONE_MARKERS.items():
            prompt = get_system_prompt(ai_tone=tone)
            self.assertIn(SYSTEM_PROMPT, prompt)
            self.assertIn(marker, prompt)

    def test_invalid_tone_uses_cute(self):
        self.assertIn(TONE_MARKERS["cute"], get_system_prompt(ai_tone="xxx"))

    def test_tone_combines_with_student_context(self):
        prompt = get_system_prompt({"grade": "lớp 8"}, ai_tone="empathetic")
        self.assertIn(TONE_MARKERS["empathetic"], prompt)
        self.assertIn("lớp 8", prompt)

    def test_build_chat_messages_uses_tone(self):
        messages = build_chat_messages([{"role": "user", "content": "chào"}], ai_tone="honest")
        self.assertEqual(messages[0]["role"], "system")
        self.assertIn(TONE_MARKERS["honest"], messages[0]["content"])
        self.assertEqual(messages[1], {"role": "user", "content": "chào"})


class TestChatEndpointTone(unittest.TestCase):
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

    def _mock_openai(self, content):
        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [_completion(content)]
        patcher = patch("openai.OpenAI", return_value=mock_client)
        patcher.start()
        self.addCleanup(patcher.stop)
        return mock_client

    def test_request_tone_switches_voice_and_response(self):
        mock_client = self._mock_openai("Trả lời dí dỏm")
        response = self.client.post(
            "/api/ai/chat",
            json={"message": "giải thích định lý Vi-ét", "aiTone": "funny"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ai_tone"], "funny")
        system_content = mock_client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn(TONE_MARKERS["funny"], system_content)

    def test_missing_tone_falls_back_to_cute(self):
        mock_client = self._mock_openai("Trả lời ngọt ngào")
        response = self.client.post("/api/ai/chat", json={"message": "giải thích định lý Vi-ét"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ai_tone"], "cute")
        system_content = mock_client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn(TONE_MARKERS["cute"], system_content)


if __name__ == "__main__":
    unittest.main()
