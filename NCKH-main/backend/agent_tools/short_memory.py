"""Short-memory tool cho agent.

Khi agent gọi, tool này:
- Lấy tên session hiện tại (bảng ai_sessions),
- Lấy messages của session (bảng ai_messages, sort created_at ASC),
- Giữ nguyên N tin gần nhất (mặc định 5),
- Các tin còn lại (cũ hơn) gộp thành một tóm tắt ngắn dạng rule-based
  (KHÔNG gọi LLM, không tốn quota OpenRouter).

Nguồn dữ liệu: Supabase (qua supabase_client.get_supabase_admin),
khớp schema với routers/ai_sessions.py. Hàm độc lập, chưa đấu nối
vào POST /api/ai/chat — agent/router gọi khi cần:

    from agent_tools import build_short_memory, render_short_memory_context
    from agent_tools import build_chat_messages  # ghép system + memory + history

Tương thích ngược: mọi hàm/c hằng số cũ giữ nguyên tên và signature
(chỉ thêm tham số optional có default) nên code cũ không cần sửa.
"""

import re
from datetime import datetime
from typing import Any
from uuid import UUID

DEFAULT_KEEP_LAST = 5
MAX_SUMMARY_CHARS = 2000
PER_MESSAGE_TRUNCATE = 200

# Giới hạn an toàn mới (đều có default nên không vỡ caller cũ).
MAX_FETCH_MESSAGES = 200  # chặn OOM khi session có hàng nghìn tin
MAX_CONTEXT_CHARS = 4000  # budget mặc định cho đoạn memory chèn vào prompt
MAX_RECENT_LINES = 8  # số dòng tối đa giữ lại mỗi tin recent (giữ công thức)
CHARS_PER_TOKEN = 4  # ước lượng thô cho tiếng Việt (~4 ký tự/token)

SESSION_TABLE = "ai_sessions"
SESSION_COLUMNS = "id,user_id,title,created_at,updated_at"
MESSAGE_TABLE = "ai_messages"
MESSAGE_COLUMNS = "id,session_id,user_id,role,content,created_at,updated_at"

_VALID_ROLES = ("user", "assistant")

# Mô tả tool cho agent/function-calling sau này (OpenAI/OpenRouter format).
TOOL_SPEC: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_short_memory",
        "description": (
            "Lấy ngữ cảnh rút gọn của phiên chat AI: tên session, N tin gần nhất "
            "và tóm tắt các tin cũ hơn. Dùng trước khi gọi model để hiểu câu hỏi."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "session_id": {"type": "string", "description": "ID phiên chat (ai_sessions.id)."},
                "keep_last": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 20,
                    "default": DEFAULT_KEEP_LAST,
                    "description": "Số tin gần nhất giữ nguyên.",
                },
            },
            "required": ["session_id"],
        },
    },
}


class SessionNotFoundError(ValueError):
    """Session không tồn tại hoặc không thuộc về user (để agent phân biệt với lỗi DB)."""


def _single_line(text: str) -> str:
    """Gộp whitespace thành 1 dòng (dùng cho tóm tắt bullet)."""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _truncate(text: str, limit: int) -> str:
    """Cắt ngắn 1 dòng, ưu tiên cắt ở ranh giới từ để dễ đọc.

    Giữ contract cũ: trả "" khi rỗng, hậu tố "…" khi bị cắt.
    Khác bản cũ ở chỗ collapse toàn bộ whitespace (không chỉ \\n)
    và không cắt giữa từ khi có thể.
    """
    if limit < 1:
        return "…"
    text = _single_line(text)
    if len(text) <= limit:
        return text
    cut = text[:limit].rstrip()
    last_space = cut.rfind(" ")
    if last_space > int(limit * 0.6):
        cut = cut[:last_space].rstrip()
    return (cut or text[:limit].rstrip()) + "…"


def _clean_multiline(text: str, max_lines: int = MAX_RECENT_LINES) -> str:
    """Chuẩn hóa tin recent: strip từng dòng, bỏ dòng trống, giữ cấu trúc.

    Khác _single_line ở chỗ GIỮ newline để không vỡ công thức Toán/Lý
    khi render ngữ cảnh cho agent đọc.
    """
    lines = [line.strip() for line in str(text or "").splitlines()]
    lines = [line for line in lines if line]
    if len(lines) > max_lines:
        lines = lines[:max_lines] + ["…"]
    return "\n".join(lines).strip()


def _clean_message(row: dict[str, Any]) -> dict[str, Any]:
    """Chuẩn hóa 1 row DB thành {role, content, created_at}.

    Role lạ (VD: system do client cũ gửi) map về "user" để log RAG nhất quán
    với schema (chỉ user|assistant). Bỏ tin content rỗng ở tầng summarize/render.
    """
    role = row.get("role")
    return {
        "role": role if role in _VALID_ROLES else "user",
        "content": str(row.get("content", "") or ""),
        "created_at": row.get("created_at"),
    }


def estimate_tokens(text: str, chars_per_token: int = CHARS_PER_TOKEN) -> int:
    """Ước lượng số token (~ký tự / 4 cho tiếng Việt). Dùng để canh budget prompt."""
    if chars_per_token < 1:
        raise ValueError("chars_per_token phải >= 1")
    return (len(str(text or "")) + chars_per_token - 1) // chars_per_token


def trim_messages_to_budget(
    messages: list[dict[str, Any]], max_chars: int
) -> list[dict[str, Any]]:
    """Giữ các tin CUỐI (mới nhất) sao cho tổng ký tự <= max_chars.

    Pure function, không gọi DB — routers/ai.py và agent dùng chung để ép quota
    mà không mất ngữ cảnh mới nhất. Trả list mới, không mutate input.
    """
    if max_chars < 1:
        raise ValueError("max_chars phải >= 1")
    kept: list[dict[str, Any]] = []
    total = 0
    for msg in reversed(messages or []):
        size = len(str((msg or {}).get("content", "") or ""))
        if kept and total + size > max_chars:
            break
        kept.append(msg)
        total += size
        if total >= max_chars:
            break
    kept.reverse()
    return kept


def _sort_key(row: dict[str, Any]) -> tuple[str, str]:
    """Key sort theo thời gian ASC, robust với nhiều định dạng ISO.

    ISO 8601 cùng định dạng sort string đã đúng; thử parse datetime để xử lý
    trường hợp lệch múi giờ/định dạng, fallback về string như bản cũ.
    """
    raw = str(row.get("created_at", "") or "")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return (parsed.isoformat(), str(row.get("id", "") or ""))
    except (ValueError, TypeError):
        return (raw, str(row.get("id", "") or ""))


def summarize_older_messages(older: list[dict[str, Any]], max_chars: int = MAX_SUMMARY_CHARS) -> str:
    """Gộp các tin cũ thành 1 đoạn tóm tắt ngắn (rule-based).

    Format: "Đoạn chat có N tin cũ (X hỏi, Y trả lời). Nội dung chính: - [user]: ... - [assistant]: ..."
    Mỗi tin cũ cắt còn PER_MESSAGE_TRUNCATE ký tự, toàn bộ summary cắt còn max_chars.
    Trả "" khi không có tin cũ.

    Cải tiến so với bản cũ: bỏ tin rỗng, khử trùng lặp liên tiếp (retry gửi 2 lần),
    role lạ chuẩn hóa về user/assistant, cắt tổng ở ranh giới dòng.
    """
    cleaned = [_clean_message(m) for m in (older or []) if isinstance(m, dict)]
    cleaned = [m for m in cleaned if _single_line(m["content"])]
    deduped: list[dict[str, Any]] = []
    for msg in cleaned:
        if deduped and deduped[-1]["role"] == msg["role"] and deduped[-1]["content"] == msg["content"]:
            continue
        deduped.append(msg)
    if not deduped:
        return ""
    n_user = sum(1 for m in deduped if m["role"] == "user")
    n_assistant = sum(1 for m in deduped if m["role"] == "assistant")
    lines = [
        f"Đoạn chat có {len(deduped)} tin cũ ({n_user} hỏi, {n_assistant} trả lời). Nội dung chính:"
    ]
    for msg in deduped:
        lines.append(f"- [{msg['role']}]: {_truncate(msg['content'], PER_MESSAGE_TRUNCATE)}")
    summary = "\n".join(lines)
    if len(summary) > max_chars:
        cut = summary[:max_chars]
        last_nl = cut.rfind("\n")
        if last_nl > int(max_chars * 0.5):
            cut = cut[:last_nl]
        summary = cut.rstrip() + "…"
    return summary


def _fetch_session_title(session_id: UUID | str, user_id: UUID | str) -> str:
    from supabase_client import get_supabase_admin

    result = (
        get_supabase_admin()
        .table(SESSION_TABLE)
        .select(SESSION_COLUMNS)
        .eq("id", str(session_id))
        .eq("user_id", str(user_id))
        .limit(1)
        .execute()
    )
    rows = list(result.data or [])
    if not rows:
        raise SessionNotFoundError(f"AI session not found: {session_id}")
    return str(rows[0].get("title", ""))


def _fetch_all_messages(
    session_id: UUID | str,
    user_id: UUID | str,
    fetch_limit: int = MAX_FETCH_MESSAGES,
) -> tuple[list[dict[str, Any]], int]:
    """Lấy messages của session, sort ASC. Thêm fetch_limit để chặn OOM.

    Không dùng .order()/.range() ở query để tương thích mọi phiên bản
    supabase-py — sort và slice thực hiện in-python như bản cũ.
    Giữ lại fetch_limit tin MỚI nhất khi vượt ngưỡng (recent luôn đầy đủ).

    Returns: (messages đã chuẩn hóa, dropped_oldest_count).
    """
    from supabase_client import get_supabase_admin

    result = (
        get_supabase_admin()
        .table(MESSAGE_TABLE)
        .select(MESSAGE_COLUMNS)
        .eq("session_id", str(session_id))
        .eq("user_id", str(user_id))
        .execute()
    )
    rows = list(result.data or [])
    rows.sort(key=_sort_key)
    dropped = 0
    if fetch_limit >= 1 and len(rows) > fetch_limit:
        dropped = len(rows) - fetch_limit
        rows = rows[-fetch_limit:]
    return ([_clean_message(row) for row in rows], dropped)


def build_short_memory(
    session_id: UUID | str,
    user_id: UUID | str,
    keep_last: int = DEFAULT_KEEP_LAST,
    max_summary_chars: int = MAX_SUMMARY_CHARS,
    fetch_limit: int = MAX_FETCH_MESSAGES,
) -> dict[str, Any]:
    """Tool chính cho agent: trả về tên session + N tin gần nhất + tóm tắt tin cũ.

    Args:
        session_id: id phiên chat hiện tại.
        user_id: id chủ sở hữu (dùng để verify quyền, khớp ai_sessions.py).
        keep_last: số tin gần nhất giữ nguyên (mặc định 5).
        max_summary_chars: độ dài tối đa của phần tóm tắt.
        fetch_limit: số tin tối đa đọc từ DB (chặn OOM, mặc định 200).

    Returns:
        {
          "session_id": str,
          "session_title": str,
          "total_messages": int,
          "recent_messages": [{role, content, created_at}] (tối đa keep_last tin cuối),
          "older_count": int,
          "summary": str ("" nếu không có tin cũ),
          "truncated": bool (True khi session dài hơn fetch_limit),
          "dropped_oldest_count": int (số tin rất cũ đã bỏ qua ngoài fetch_limit),
        }

    Raises:
        SessionNotFoundError: session không tồn tại / không thuộc về user.
        ValueError: keep_last < 1.
    """
    if keep_last < 1:
        raise ValueError("keep_last phải >= 1")
    if fetch_limit < 1:
        raise ValueError("fetch_limit phải >= 1")
    if max_summary_chars < 1:
        raise ValueError("max_summary_chars phải >= 1")
    fetch_limit = max(fetch_limit, keep_last)
    title = _fetch_session_title(session_id, user_id)
    messages, dropped = _fetch_all_messages(session_id, user_id, fetch_limit=fetch_limit)
    total = len(messages) + dropped
    recent = messages[-keep_last:] if messages else []
    older = messages[:-keep_last] if len(messages) > keep_last else []
    summary = summarize_older_messages(older, max_chars=max_summary_chars)
    if dropped and summary:
        summary = f"(+{dropped} tin rất cũ đã bỏ qua để tiết kiệm bộ nhớ)\n" + summary
    return {
        "session_id": str(session_id),
        "session_title": title,
        "total_messages": total,
        "recent_messages": recent,
        "older_count": len(older) + dropped,
        "summary": summary,
        "truncated": dropped > 0,
        "dropped_oldest_count": dropped,
    }


def format_memory_for_llm(memory: dict[str, Any], max_chars: int = MAX_CONTEXT_CHARS) -> str:
    """Render short-memory thành 1 đoạn text gọn trong budget để chèn vào prompt.

    Khác bản render cũ: mỗi tin recent giữ cấu trúc dòng (không vỡ công thức),
    cắt mỗi tin còn PER_MESSAGE_TRUNCATE ký tự, toàn bộ đoạn cắt còn max_chars
    ở ranh giới dòng.
    """
    memory = memory or {}
    title = str(memory.get("session_title", "") or "").strip() or "đoạn chat"
    parts = [f'[Ngữ cảnh {title}]']
    summary = _single_line(memory.get("summary") or "")
    parts.append(f"Tóm tắt tin cũ: {summary}" if summary else "Tóm tắt tin cũ: (không có)")
    recent = [m for m in (memory.get("recent_messages") or []) if isinstance(m, dict)]
    recent = [m for m in recent if _single_line(m.get("content") or "")]
    if recent:
        parts.append(f"{len(recent)} tin gần nhất:")
        for msg in recent:
            role = msg.get("role") if msg.get("role") in _VALID_ROLES else "user"
            content = _clean_multiline(msg.get("content") or "")
            content = _truncate(content, PER_MESSAGE_TRUNCATE * 2)
            parts.append(f"- [{role}]: {content}")
    else:
        parts.append("Chưa có tin nhắn nào.")
    text = "\n".join(parts)
    if len(text) > max_chars:
        cut = text[:max_chars]
        last_nl = cut.rfind("\n")
        if last_nl > int(max_chars * 0.5):
            cut = cut[:last_nl]
        text = cut.rstrip() + "…"
    return text


def render_short_memory_context(
    memory: dict[str, Any], max_chars: int = MAX_CONTEXT_CHARS
) -> str:
    """Render short-memory thành 1 đoạn text để chèn vào prompt của agent.

    Ví dụ output:
        [Ngữ cảnh đoạn chat "Ôn thi Toán"]
        Tóm tắt tin cũ: ...
        5 tin gần nhất:
        - [user]: ...

    Giữ tương thích ngược (gọi 1 đối số vẫn chạy); logic mới nằm ở
    format_memory_for_llm để agent chọn budget tùy ý.
    """
    memory = memory or {}
    title = str(memory.get("session_title", "") or "").strip()
    header = f'[Ngữ cảnh đoạn chat "{title}"]' if title else '[Ngữ cảnh đoạn chat ""]'
    body = format_memory_for_llm(memory, max_chars=max_chars)
    # format_memory_for_llm đã có header dạng '[Ngữ cảnh <title>]' — thay bằng
    # header đúng format cũ (có chữ "đoạn chat" + quote) để snapshot cũ không vỡ.
    lines = body.split("\n")
    if lines:
        lines[0] = header
    text = "\n".join(lines)
    # Đồng bộ câu đếm: bản cũ ghi "N tin gần nhất:", bản mới trong body cũng vậy.
    return text
