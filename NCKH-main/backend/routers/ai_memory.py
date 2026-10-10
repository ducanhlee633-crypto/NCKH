# Router trí nhớ dài hạn cho AI (Settings "Quản lí trí nhớ AI").
# Thuần CRUD thủ công, KHÔNG cho AI tự ghi (theo chốt với user).
#
# - GET    /ai/memory                 liệt kê của mình (mới nhất trước)
#          ?tag=info|hobby|study|goal|habit|note  lọc theo tag (dùng index user_id+tag)
#          ?q=...                    lọc chứa từ khóa (case-insensitive, in-python)
#          ?limit=&offset=            phân trang (limit 1..50, mặc định 50)
# - POST   /ai/memory                 thêm 1 mẩu (tối đa 50 dòng/user)
# - GET    /ai/memory/{id}            đọc 1 mẩu của mình
# - PUT    /ai/memory/{id}            sửa tag/content (PATCH là alias)
# - DELETE /ai/memory/{id}            xóa 1 mẩu (204)
#
# POST /api/ai/chat tự ĐỌC bảng này trước mỗi lượt chat
# (xem agent_tools/long_term_memory.py + routers/ai.py).
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import (
    MEMORY_CONTENT_MAX_LENGTH,
    MEMORY_MAX_PER_USER,
    MEMORY_TAG_VALUES,
    AiMemory,
    AiMemoryCreate,
    AiMemoryUpdate,
)
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/ai/memory", tags=["ai-memory"])

TABLE = "ai_memories"
COLUMNS = "id,user_id,tag,content,created_at,updated_at"

DEFAULT_LIMIT = 50
MAX_LIMIT = 50


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _normalize_tag(value: object) -> str:
    tag = str(value or "note").strip()
    return tag if tag in MEMORY_TAG_VALUES else "note"


def _to_memory(row: dict) -> AiMemory:
    data = dict(row)
    if data.get("tag") not in MEMORY_TAG_VALUES:
        data["tag"] = "note"
    return AiMemory.model_validate(data)


async def _fetch_one(memory_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("id", str(memory_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")
    return result.data[0]


async def _count_mine(user_id: UUID) -> int:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select("id")
                .eq("user_id", str(user_id))
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return len(result.data or [])


@router.get("", response_model=list[AiMemory])
async def list_memories(
    current: SupabaseUser = Depends(get_current_supabase_user),
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
) -> list[AiMemory]:
    """Liệt kê trí nhớ của chính mình (mới cập nhật trước).

    - `tag` lọc đúng 1 tag (backend đẩy `.eq("tag", ...)` để dùng index (user_id, tag)).
    - `q` lọc chứa từ khóa trong content (in-python, case-insensitive).
    """
    if tag is not None and tag not in MEMORY_TAG_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tag phải là một trong: info, hobby, study, goal, habit, note.",
        )
    try:
        query = get_supabase_admin().table(TABLE).select(COLUMNS).eq("user_id", str(current.id))
        # Đẩy filter tag xuống DB để tận dụng index (user_id, tag) — nhanh hơn lọc python.
        if tag is not None:
            query = query.eq("tag", tag)
        result = await run_blocking(lambda: query.execute())
    except Exception as error:
        _db_error(error)
    rows = list(result.data or [])
    keyword = str(q or "").strip().lower()
    if keyword:
        rows = [row for row in rows if keyword in str(row.get("content", "") or "").lower()]
    rows.sort(key=lambda row: (str(row.get("updated_at", "")), str(row.get("id", ""))), reverse=True)
    return [_to_memory(row) for row in rows[offset : offset + limit]]


@router.post("", response_model=AiMemory, status_code=status.HTTP_201_CREATED)
async def create_memory(
    payload: AiMemoryCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMemory:
    """Thêm 1 mẩu trí nhớ (tối đa 50 dòng/user)."""
    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nội dung trí nhớ không được để trống.",
        )
    if len(content) > MEMORY_CONTENT_MAX_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Nội dung tối đa {MEMORY_CONTENT_MAX_LENGTH} ký tự.",
        )
    if await _count_mine(current.id) >= MEMORY_MAX_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Bạn đã lưu tối đa {MEMORY_MAX_PER_USER} mẩu trí nhớ. Hãy xóa bớt trước khi thêm.",
        )
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .insert(
                    {
                        "user_id": str(current.id),
                        "tag": _normalize_tag(payload.tag),
                        "content": content,
                    }
                )
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_memory(result.data[0])


@router.get("/{memory_id}", response_model=AiMemory)
async def read_memory(
    memory_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMemory:
    """Đọc 1 mẩu trí nhớ của chính mình."""
    return _to_memory(await _fetch_one(memory_id, current.id))


async def _apply_update(memory_id: UUID, payload: AiMemoryUpdate, user_id: UUID) -> AiMemory:
    row = await _fetch_one(memory_id, user_id)
    current = _to_memory(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "tag" in values and values["tag"] is not None:
        values["tag"] = _normalize_tag(values["tag"])
    if "content" in values and values["content"] is not None:
        values["content"] = str(values["content"]).strip()
        if not values["content"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nội dung trí nhớ không được để trống.",
            )
    if not values:
        return current
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .update(values)
                .eq("id", str(memory_id))
                .eq("user_id", str(user_id))
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory not found")
    return _to_memory(result.data[0])


@router.put("/{memory_id}", response_model=AiMemory)
async def update_memory(
    memory_id: UUID,
    payload: AiMemoryUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMemory:
    """Sửa tag/content (chỉ field được gửi mới đổi)."""
    return await _apply_update(memory_id, payload, current.id)


@router.patch("/{memory_id}", response_model=AiMemory)
async def patch_memory(
    memory_id: UUID,
    payload: AiMemoryUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMemory:
    """Alias của PUT cho client thích PATCH từng field."""
    return await _apply_update(memory_id, payload, current.id)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa 1 mẩu trí nhớ của mình (204)."""
    await _fetch_one(memory_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(memory_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
