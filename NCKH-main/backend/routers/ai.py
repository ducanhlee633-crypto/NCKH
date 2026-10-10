"""Router chat AI cho AIAssistantPage.jsx.

Contract (JSON, không stream — theo chốt với user):
- POST /api/ai/chat
- Request: { "messages": [{ "role": "user"|"assistant", "content": "..." }], "message": "..." (optional),
              "aiTone": "cute|honest|funny|empathetic" (optional — giọng frontend đang xem, ưu tiên hơn DB),
              "tags": ["info"|"hobby"|"study"|"goal"|"habit"|"note"] (optional — hint lọc trí nhớ),
              "sessionId": "uuid" (optional — id phiên chat đang mở, để log/trace) }
  Frontend gửi toàn bộ hội thoại đang hiển thị; backend không lưu memory server-side.
  Văn phong trả lời lấy theo aiTone trong request, thiếu thì đọc user_preferences.ai_tone,
  rồi nối khối văn phong tương ứng (agent_tools/system_prompt.py) vào system prompt.
- Response: { "reply": "...", "model": "...", "ai_tone": "cute",
               "memory_used": 0, "memory_tags": [] } (giọng + memory đã áp dụng)

Trí nhớ dài hạn (bảng ai_memories, user tự quản trong Settings):
- Mỗi lượt chat backend ĐỌC TRƯỚC bảng này rồi mới gọi model
  (xem agent_tools/long_term_memory.py): ưu tiên lọc theo tag
  (tags hint -> suy từ câu hỏi -> mới nhất), dùng index (user_id, tag).
- Lỗi DB memory luôn fallback chat thường, không vỡ chat.

Dùng OpenAI SDK trỏ về OpenRouter (base_url=https://openrouter.ai/api/v1).
Key lấy từ backend/.env (OPENROUTER_API_KEY), không bao giờ lộ ra frontend.
Yêu cầu đăng nhập Supabase như các router khác.

Search tài liệu (agent_tools.web_search.search_documents):
- Câu hỏi kêu "tìm tài liệu..." rõ ràng -> backend tự search rồi gọi model 1 lần kèm kết quả.
- Còn lại model tự quyết định gọi tool search_documents qua function-calling
  (tối đa 1 lượt search/lượt chat); model không hỗ trợ tool thì chat thường.
Search hỏng/rate-limit thì fallback trả lời chay, không vỡ chat.
"""

import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from agent_tools.long_term_memory import (
    MEMORY_TAG_VALUES as LONG_TERM_TAG_VALUES,
)
from agent_tools.long_term_memory import (
    fetch_relevant_memories,
    format_long_term_memory,
    normalize_memory_tags,
)
from agent_tools.system_prompt import SYSTEM_PROMPT, build_chat_messages, normalize_ai_tone
from agent_tools.web_search import TOOL_SPEC as SEARCH_TOOL_SPEC
from agent_tools.web_search import (
    DEFAULT_MAX_RESULTS as SEARCH_DEFAULT_MAX_RESULTS,
)
from agent_tools.web_search import (
    SearchUnavailableError,
    extract_search_query,
    format_results_for_llm,
    looks_like_search_request,
    search_documents,
)
from auth import SupabaseUser, get_current_supabase_user
from async_utils import run_blocking
from config import get_settings

router = APIRouter(prefix="/ai", tags=["ai"])

# SYSTEM_PROMPT dùng chung nằm ở agent_tools/system_prompt.py (import lại ở đây
# để code cũ dùng `from routers.ai import SYSTEM_PROMPT` không bị vỡ).
__all__ = ["SYSTEM_PROMPT", "router"]

DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
MAX_MESSAGES = 20
MAX_CHARS_TOTAL = 12000
# Tối đa 1 lượt gọi search/lượt chat (chống lặp tool vô hạn).
MAX_SEARCH_TURNS = 1
SEARCH_CONTEXT_INSTRUCTION = (
    "Dưới đây là kết quả tìm kiếm web mới nhất cho câu hỏi của học sinh. "
    "Hãy trả lời ngắn gọn bằng tiếng Việt, tóm tắt 2-4 điểm chính rồi liệt kê "
    "các link (giữ nguyên URL, mỗi link một dòng dạng Markdown [tiêu đề](url)) "
    "để bạn ấy bấm vào đọc tiếp. Không bịa thêm link. "
    "TUYỆT ĐỐI KHÔNG viết câu kiểu \"bạn hãy tìm...\", \"hãy search...\", "
    "\"lên Google tìm...\" — link thật đã có ngay bên dưới, hãy đưa link ra luôn."
)
SEARCH_FAILED_NOTE = (
    "Công cụ tìm kiếm web vừa không trả kết quả. Hãy trả lời bằng kiến thức của bạn "
    "và nói rõ là không tìm được tài liệu mới, gợi ý học sinh thử lại sau."
)


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"] = Field(default="user")
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    model_config = {"populate_by_name": True}

    messages: list[ChatMessage] | None = None
    message: str | None = Field(default=None, max_length=4000)
    # Chất giọng AI (SettingsPage -> user_preferences.ai_tone).
    # Frontend gửi camelCase `aiTone` (bản chưa bấm Lưu); backend ưu tiên giá trị này,
    # thiếu thì đọc từ DB, hỏng DB thì fallback 'cute'.
    ai_tone: str | None = Field(default=None, max_length=20, alias="aiTone")
    # Hint lọc trí nhớ dài hạn (Settings "Quản lí trí nhớ AI" -> ai_memories.tag).
    # Frontend (AIAssistantPage) gửi tag đang lọc / suy từ câu hỏi; backend chuẩn hóa
    # về 6 tag hợp lệ, lạ/rỗng thì tự suy từ câu hỏi rồi fallback đọc mới nhất.
    # Gửi camelCase `sessionId` (id phiên chat đang mở) để trace, không bắt buộc.
    tags: list[str] | None = Field(default=None, max_length=6)
    session_id: UUID | None = Field(default=None, alias="sessionId")


class ChatResponse(BaseModel):
    reply: str
    model: str
    # Giọng văn đã áp dụng cho câu trả lời (để frontend hiển thị đúng lựa chọn của user).
    ai_tone: str = "cute"
    # Trí nhớ dài hạn đã dùng cho lượt này (để frontend debug/hiển thị "AI có nhớ bạn").
    memory_used: int = 0
    memory_tags: list[str] = Field(default_factory=list)


def _normalize_messages(payload: ChatRequest) -> list[dict]:
    """Gộp `messages` + `message` thành list message OpenAI, cắt gọn chống vượt quota."""
    collected: list[ChatMessage] = list(payload.messages or [])
    if payload.message and payload.message.strip():
        collected.append(ChatMessage(role="user", content=payload.message.strip()))
    # Bỏ system do client gửi (server tự chèn SYSTEM_PROMPT), bỏ content rỗng.
    cleaned = [
        {"role": msg.role, "content": msg.content.strip()}
        for msg in collected
        if msg.role in ("user", "assistant") and msg.content.strip()
    ]
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy nhập câu hỏi trước khi gửi.",
        )
    # Chỉ giữ N message cuối (đủ chat 2 chiều, chưa cần memory server).
    trimmed = cleaned[-MAX_MESSAGES:]
    # Cắt tổng ký tự nếu quá dài.
    total = sum(len(m["content"]) for m in trimmed)
    while total > MAX_CHARS_TOTAL and len(trimmed) > 1:
        removed = trimmed.pop(0)
        total -= len(removed["content"])
    if total > MAX_CHARS_TOTAL:
        trimmed[0]["content"] = trimmed[0]["content"][:MAX_CHARS_TOTAL]
    return trimmed


def _request_completion(client, model, messages, extra_headers, tools=None):
    """Gọi OpenRouter một lượt. tools=None nghĩa là chat thường (không function-calling)."""
    kwargs: dict = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        # Nemotron-3-super là reasoning model: reasoning tokens tính chung vào
        # max_tokens. Để 1000 như trước thì reasoning ăn hết budget -> content rỗng
        # + finish_reason=length -> 502. Tăng lên 3000 + ép reasoning effort=low.
        "max_tokens": 3000,
        "stream": False,
        "extra_headers": extra_headers or None,
        # effort low (~20% budget cho reasoning) + exclude để không trả reasoning về.
        "extra_body": {"reasoning": {"effort": "low", "exclude": True}},
    }
    if tools is not None:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    try:
        return client.chat.completions.create(**kwargs)
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"OpenRouter lỗi: {error}",
        ) from error


def _extract_reply(completion) -> str:
    """Lấy text trả lời, 502 khi model không trả nội dung (giữ hành vi cũ)."""
    try:
        reply = (completion.choices[0].message.content or "").strip()
    except (AttributeError, IndexError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI không trả về nội dung.",
        ) from error
    if not reply:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI không trả về nội dung.",
        )
    return reply


def _run_search(query: str, max_results: int = SEARCH_DEFAULT_MAX_RESULTS) -> list[dict]:
    """Chạy search_documents, lỗi mạng/rate-limit thì trả [] để caller fallback chat thường."""
    try:
        return search_documents(query, max_results=max_results)
    except (SearchUnavailableError, ValueError):
        return []


async def _resolve_ai_tone(payload: ChatRequest, current: SupabaseUser) -> str:
    """Chất giọng AI hiệu lực: request (bản chưa Lưu) > DB user_preferences > 'cute'."""
    direct = (payload.ai_tone or "").strip()
    if direct:
        return normalize_ai_tone(direct)
    try:
        from supabase_client import get_supabase_admin

        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table("user_preferences")
                .select("ai_tone")
                .eq("id", str(current.id))
                .limit(1)
                .execute()
            )
        )
        rows = getattr(result, "data", None) or []
        if rows and isinstance(rows[0], dict) and rows[0].get("ai_tone"):
            return normalize_ai_tone(rows[0]["ai_tone"])
    except Exception:
        pass
    return "cute"


@router.post("/chat", response_model=ChatResponse)
async def chat_with_ai(
    payload: ChatRequest,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> ChatResponse:
    """Chat 2 chiều với model OpenRouter (JSON, không stream)."""
    import asyncio

    settings = get_settings()
    api_key = (settings.openrouter_api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dịch vụ AI chưa được cấu hình (thiếu OPENROUTER_API_KEY).",
        )
    model = (settings.openrouter_model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    user_messages = _normalize_messages(payload)
    last_user_text = next((m["content"] for m in reversed(user_messages) if m["role"] == "user"), "")
    # Giọng AI (DB) + trí nhớ dài hạn (DB): 2 query độc lập -> chạy song song.
    tags_hint = normalize_memory_tags(payload.tags)
    ai_tone, memory_rows = await asyncio.gather(
        _resolve_ai_tone(payload, current),
        run_blocking(fetch_relevant_memories, current.id, last_user_text, tags_hint),
    )
    memory_text = format_long_term_memory(memory_rows)
    memory_tags = sorted({str(r.get("tag", "")) for r in (memory_rows or []) if str(r.get("tag", "")) in LONG_TERM_TAG_VALUES})
    base_messages = build_chat_messages(user_messages, memory_text=memory_text or None, ai_tone=ai_tone)

    try:
        from openai import OpenAI
    except ImportError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Backend thiếu thư viện openai. Hãy chạy pip install openai.",
        ) from error

    extra_headers: dict[str, str] = {}
    if settings.openrouter_site_url:
        extra_headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        extra_headers["X-Title"] = settings.openrouter_app_name

    client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
        timeout=60.0,
    )

    # Nhánh 1 — câu hỏi kêu tìm tài liệu rõ ràng: search trước, gọi model 1 lần
    # kèm kết quả. Không phụ thuộc model có hỗ trợ function-calling hay không.
    if looks_like_search_request(last_user_text):
        query = extract_search_query(last_user_text)
        found = await run_blocking(_run_search, query)
        if found:
            with_context = [
                *base_messages,
                {
                    "role": "system",
                    "content": SEARCH_CONTEXT_INSTRUCTION + "\n" + format_results_for_llm(found, query),
                },
            ]
            completion = await run_blocking(_request_completion, client, model, with_context, extra_headers)
            return ChatResponse(
                reply=_extract_reply(completion),
                model=model,
                ai_tone=ai_tone,
                memory_used=len(memory_rows),
                memory_tags=memory_tags,
            )
        # Search hỏng/rỗng → rơi xuống chat thường bên dưới.

    # Nhánh 2 — agentic: để model tự quyết định gọi tool search_documents.
    try:
        first = await run_blocking(_request_completion, client, model, base_messages, extra_headers, [SEARCH_TOOL_SPEC])
    except HTTPException as error:
        # Model/endpoint không hỗ trợ tools → chat thường, giữ nguyên hành vi cũ.
        if "tool" not in str(error.detail).lower():
            raise
        plain = await run_blocking(_request_completion, client, model, base_messages, extra_headers)
        return ChatResponse(
            reply=_extract_reply(plain), model=model, ai_tone=ai_tone,
            memory_used=len(memory_rows), memory_tags=memory_tags,
        )

    calls = list(getattr(first.choices[0].message, "tool_calls", None) or [])
    search_call = next(
        (call for call in calls if getattr(getattr(call, "function", None), "name", "") == "search_documents"),
        None,
    )
    if search_call is None:
        return ChatResponse(
            reply=_extract_reply(first), model=model, ai_tone=ai_tone,
            memory_used=len(memory_rows), memory_tags=memory_tags,
        )

    try:
        args = json.loads(getattr(search_call.function, "arguments", "") or "{}")
        if not isinstance(args, dict):
            args = {}
    except (json.JSONDecodeError, TypeError, AttributeError):
        args = {}
    query = str(args.get("query", "") or "").strip() or extract_search_query(last_user_text)
    try:
        limit = int(args.get("max_results", SEARCH_DEFAULT_MAX_RESULTS))
    except (TypeError, ValueError):
        limit = SEARCH_DEFAULT_MAX_RESULTS
    found = await run_blocking(_run_search, query, limit)
    if found:
        tool_content = format_results_for_llm(found, query)
    else:
        tool_content = "Không tìm được kết quả. " + SEARCH_FAILED_NOTE
    try:
        raw_arguments = str(getattr(search_call.function, "arguments", "") or "{}")
    except AttributeError:
        raw_arguments = "{}"
    second_messages = [
        *base_messages,
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": getattr(search_call, "id", "call_1"),
                    "type": "function",
                    "function": {"name": "search_documents", "arguments": raw_arguments},
                }
            ],
        },
        {"role": "tool", "tool_call_id": getattr(search_call, "id", "call_1"), "content": tool_content},
    ]
    # Chỉ 1 lượt search/lượt chat (MAX_SEARCH_TURNS): lượt 2 không kèm tools nữa.
    second = await run_blocking(_request_completion, client, model, second_messages, extra_headers)
    return ChatResponse(
        reply=_extract_reply(second), model=model, ai_tone=ai_tone,
        memory_used=len(memory_rows), memory_tags=memory_tags,
    )
