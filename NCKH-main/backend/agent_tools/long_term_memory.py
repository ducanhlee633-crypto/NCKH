"""Long-term memory tool cho trợ lý Nhịp Học (bảng ai_memories).

Nguyên tắc (theo chốt với user):
- Chỉ ĐỌC, không tự ghi: user tự thêm/sửa/xóa trong Settings "Quản lí trí nhớ AI".
- Mỗi lần vào session chat / gửi chat, backend ĐỌC trước bảng này
  rồi mới gọi model (xem routers/ai.py).
- Ưu tiên tìm theo TAG để nhanh (dùng index DB (user_id, tag)):
  frontend có thể gửi `tags` hint, thiếu thì suy từ câu hỏi qua từ khóa.

Tag cố định 6 giá trị (khớp schema.MEMORY_TAG_VALUES + frontend data/memory.js):
- info:  Thông tin cá nhân (tên, lớp, trường...)
- hobby: Sở thích (môn thích, game, nhạc...)
- study: Học tập (môn mạnh/yếu, cách học...)
- goal:  Mục tiêu (điểm muốn đạt, trường muốn vào...)
- habit: Thói quen (giờ học, ngủ, nghỉ...)
- note:  Ghi chú khác
"""

from typing import Any
from uuid import UUID

MEMORY_TABLE = "ai_memories"
MEMORY_COLUMNS = "id,user_id,tag,content,created_at,updated_at"

MEMORY_TAG_VALUES = ("info", "hobby", "study", "goal", "habit", "note")

# Budget ghép vào system prompt: đủ nhớ mà không nuốt quota chat.
MAX_MEMORY_ITEMS = 20
MAX_MEMORY_CHARS = 2000

# Từ khóa tiếng Việt (không dấu cũng bắt được vì so lower + có cả biến thể)
# để suy tag liên quan khi frontend không gửi hint.
TAG_KEYWORDS: dict[str, tuple[str, ...]] = {
    "info": ("tên", "ten ", "lớp", "lop ", "trường", "truong", "tuổi", "tuoi", "sinh năm", "ở đâu", "o dau"),
    "hobby": ("thích", "thich", "sở thích", "so thich", "đam mê", "dam me", "ghét", "ghet", "game", "nhạc", "nhac", "bóng", "bong", "vẽ", "ve "),
    "study": ("môn", "mon ", "học", "hoc ", "bài", "bai ", "yếu", "yeu ", "mạnh", "manh", "điểm", "diem", "thi ", "kiểm tra", "kiem tra", "ôn ", "on "),
    "goal": ("mục tiêu", "muc tieu", "muốn đạt", "muon dat", "dự định", "du dinh", "ước mơ", "uoc mo", "trường muốn", "nguyện vọng", "nguyen vong"),
    "habit": ("thói quen", "thoi quen", "thường", "thuong", "mỗi ngày", "moi ngay", "dậy", "day ", "ngủ", "ngu ", "nghỉ", "nghi ", "pomodoro", "25 phút", "25 phut"),
}


def normalize_memory_tags(values: Any) -> list[str]:
    """Chuẩn hóa hint tag từ frontend về list tag hợp lệ (bỏ trùng, giữ thứ tự)."""
    if not isinstance(values, (list, tuple)):
        return []
    out: list[str] = []
    for item in values:
        tag = str(item or "").strip()
        if tag in MEMORY_TAG_VALUES and tag not in out:
            out.append(tag)
    return out


def infer_tags_from_text(text: str, max_tags: int = 2) -> list[str]:
    """Suy 1-2 tag liên quan từ câu hỏi (rule-based, không gọi LLM).

    Trả [] khi không khớp từ khóa nào — caller fallback đọc mới nhất.
    """
    lowered = f" {str(text or '').lower()} "
    scored: list[tuple[int, str]] = []
    for tag, keywords in TAG_KEYWORDS.items():
        hits = sum(1 for kw in keywords if kw in lowered)
        if hits:
            scored.append((hits, tag))
    scored.sort(reverse=True)
    return [tag for _, tag in scored[:max(1, max_tags)]]


def _sort_key(row: dict[str, Any]) -> tuple[str, str]:
    return (str(row.get("updated_at", "") or ""), str(row.get("id", "") or ""))


def fetch_relevant_memories(
    user_id: UUID | str,
    question_text: str = "",
    tags_hint: list[str] | None = None,
    limit: int = MAX_MEMORY_ITEMS,
) -> list[dict[str, Any]]:
    """ĐỌC trí nhớ dài hạn của user trước mỗi lượt chat (không bao giờ raise).

    Chiến lược nhanh theo chốt "ưu tiên index thứ nó cần":
    1. Có `tags_hint` hợp lệ -> query từng tag bằng `.eq("user_id").eq("tag")`
       để DB dùng index (user_id, tag), gộp lại.
    2. Không hint -> suy tag từ câu hỏi bằng infer_tags_from_text, query như (1).
    3. Vẫn rỗng / DB lỗi -> fallback đọc N dòng mới nhất (1 query duy nhất).
    Lỗi DB luôn trả [] để chat không vỡ (giữ hành vi fallback như web_search).
    """
    from supabase_client import get_supabase_admin

    hint = normalize_memory_tags(tags_hint)
    if not hint and question_text:
        hint = infer_tags_from_text(question_text)
    try:
        db = get_supabase_admin()
        if hint:
            merged: list[dict[str, Any]] = []
            seen: set[str] = set()
            per_tag = max(1, (limit + len(hint) - 1) // len(hint))
            for tag in hint:
                result = (
                    db.table(MEMORY_TABLE)
                    .select(MEMORY_COLUMNS)
                    .eq("user_id", str(user_id))
                    .eq("tag", tag)
                    .execute()
                )
                rows = list(getattr(result, "data", None) or [])
                rows.sort(key=_sort_key, reverse=True)
                for row in rows[:per_tag]:
                    row_id = str(row.get("id", ""))
                    if row_id and row_id not in seen:
                        seen.add(row_id)
                        merged.append(row)
                    if len(merged) >= limit:
                        break
                if len(merged) >= limit:
                    break
            # Vẫn thiếu (VD: tag gợi ý chưa có dòng nào) -> bù bằng mới nhất.
            if len(merged) < limit:
                result = (
                    db.table(MEMORY_TABLE)
                    .select(MEMORY_COLUMNS)
                    .eq("user_id", str(user_id))
                    .execute()
                )
                rows = list(getattr(result, "data", None) or [])
                rows.sort(key=_sort_key, reverse=True)
                for row in rows:
                    row_id = str(row.get("id", ""))
                    if row_id and row_id not in seen:
                        seen.add(row_id)
                        merged.append(row)
                    if len(merged) >= limit:
                        break
            merged.sort(key=_sort_key, reverse=True)
            return merged[:limit]
        result = (
            db.table(MEMORY_TABLE)
            .select(MEMORY_COLUMNS)
            .eq("user_id", str(user_id))
            .execute()
        )
        rows = list(getattr(result, "data", None) or [])
        rows.sort(key=_sort_key, reverse=True)
        return rows[:limit]
    except Exception:
        return []


TAG_LABELS_VI: dict[str, str] = {
    "info": "Thông tin",
    "hobby": "Sở thích",
    "study": "Học tập",
    "goal": "Mục tiêu",
    "habit": "Thói quen",
    "note": "Ghi chú",
}


def format_long_term_memory(rows: list[dict[str, Any]], max_chars: int = MAX_MEMORY_CHARS) -> str:
    """Render N mẩu trí nhớ thành 1 đoạn ngắn để nối vào system prompt.

    Format mỗi dòng: `- [Tag]: content` (1 dòng/mẩu, cắt 200 ký tự/mẩu).
    Trả "" khi không có gì — caller giữ nguyên prompt gốc.
    """
    cleaned: list[str] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        tag = str(row.get("tag", "") or "").strip()
        if tag not in MEMORY_TAG_VALUES:
            tag = "note"
        content = " ".join(str(row.get("content", "") or "").split())
        if not content:
            continue
        if len(content) > 200:
            content = content[:200].rstrip() + "…"
        cleaned.append(f"- [{TAG_LABELS_VI.get(tag, tag)}]: {content}")
        if len(cleaned) >= MAX_MEMORY_ITEMS:
            break
    if not cleaned:
        return ""
    text = "Trí nhớ về bạn (do bạn lưu trong Cài đặt, dùng để hiểu câu hỏi, đừng nhắc lại nguyên văn trừ khi được hỏi):\n" + "\n".join(cleaned)
    if len(text) > max_chars:
        cut = text[:max_chars]
        last_nl = cut.rfind("\n")
        if last_nl > int(max_chars * 0.5):
            cut = cut[:last_nl]
        text = cut.rstrip() + "…"
    return text
