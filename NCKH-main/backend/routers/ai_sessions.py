# Router lưu trữ lịch sử chat AI (tiền đề RAG sau này).
# Thuần CRUD, KHÔNG gọi model AI (logic gọi OpenRouter nằm ở routers/ai.py).
#
# - POST   /ai/sessions            tạo session mới (title do frontend gửi)
# - GET    /ai/sessions            liệt kê session của mình (mới nhất trước)
# - GET    /ai/sessions/{id}       đọc 1 session của mình
# - PUT    /ai/sessions/{id}       sửa title (PATCH là alias)
# - DELETE /ai/sessions/{id}       xóa session + toàn bộ messages (204)
# - POST   /ai/sessions/{id}/messages          lưu 1 message user/assistant
# - GET    /ai/sessions/{id}/messages          đọc messages theo created_at ASC
#          (hỗ trợ limit/offset để phân trang + dựng context RAG)
# - PUT    /ai/sessions/{id}/messages/{mid}    sửa content message (PATCH alias)
# - DELETE /ai/sessions/{id}/messages/{mid}    xóa 1 message (204)
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import AiMessage, AiMessageCreate, AiMessageUpdate, AiSession, AiSessionCreate, AiSessionUpdate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/ai/sessions", tags=["ai-sessions"])

SESSION_TABLE = "ai_sessions"
SESSION_COLUMNS = "id,user_id,title,created_at,updated_at"
MESSAGE_TABLE = "ai_messages"
MESSAGE_COLUMNS = "id,session_id,user_id,role,content,created_at,updated_at"

DEFAULT_MESSAGE_LIMIT = 200
MAX_MESSAGE_LIMIT = 1000


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _to_session(row: dict) -> AiSession:
    return AiSession.model_validate(row)


def _to_message(row: dict) -> AiMessage:
    return AiMessage.model_validate(row)


async def _fetch_session(session_id: UUID, user_id: UUID) -> dict:
    """Lấy session của chính mình, 404 nếu không thuộc về user."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(SESSION_TABLE)
                .select(SESSION_COLUMNS)
                .eq("id", str(session_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI session not found")
    return result.data[0]


async def _fetch_message(message_id: UUID, session_id: UUID, user_id: UUID) -> dict:
    """Lấy message thuộc đúng session của chính mình."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(MESSAGE_TABLE)
                .select(MESSAGE_COLUMNS)
                .eq("id", str(message_id))
                .eq("session_id", str(session_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI message not found")
    return result.data[0]


async def _touch_session(session_id: UUID, user_id: UUID) -> None:
    """Chạm updated_at của session sau khi messages thay đổi (để sort 'gần đây nhất')."""
    try:
        row = await _fetch_session(session_id, user_id)
        await run_blocking(
            lambda: (
                get_supabase_admin().table(SESSION_TABLE).update({"title": row["title"]}).eq(
                    "id", str(session_id)
                ).eq("user_id", str(user_id)).execute()
            )
        )
    except HTTPException:
        raise
    except Exception as error:
        _db_error(error)


# ---------------- Sessions ----------------


@router.get("", response_model=list[AiSession])
async def list_ai_sessions(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> list[AiSession]:
    """Liệt kê session của chính mình (mới cập nhật trước)."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(SESSION_TABLE)
                .select(SESSION_COLUMNS)
                .eq("user_id", str(current.id))
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    rows = list(result.data or [])
    rows.sort(key=lambda row: (str(row.get("updated_at", "")), str(row.get("id", ""))), reverse=True)
    return [_to_session(row) for row in rows]


@router.post("", response_model=AiSession, status_code=status.HTTP_201_CREATED)
async def create_ai_session(
    payload: AiSessionCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiSession:
    """Tạo session mới — title do frontend gửi lên."""
    title = payload.title.strip()
    if not title:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tiêu đề đoạn chat không được để trống.",
        )
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(SESSION_TABLE)
                .insert({"user_id": str(current.id), "title": title})
                .select(SESSION_COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_session(result.data[0])


@router.get("/{session_id}", response_model=AiSession)
async def read_ai_session(
    session_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiSession:
    """Đọc 1 session của chính mình."""
    return _to_session(await _fetch_session(session_id, current.id))


async def _apply_session_update(session_id: UUID, payload: AiSessionUpdate, user_id: UUID) -> AiSession:
    row = await _fetch_session(session_id, user_id)
    current = _to_session(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    # Chuẩn hóa title: strip, bỏ qua nếu rỗng (pydantic đã chặn rỗng, đây là phòng thủ).
    if "title" in values and values["title"] is not None:
        values["title"] = str(values["title"]).strip()
        if not values["title"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Tiêu đề đoạn chat không được để trống.",
            )
    if not values:
        return current
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(SESSION_TABLE)
                .update(values)
                .eq("id", str(session_id))
                .eq("user_id", str(user_id))
                .select(SESSION_COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI session not found")
    return _to_session(result.data[0])


@router.put("/{session_id}", response_model=AiSession)
async def update_ai_session(
    session_id: UUID,
    payload: AiSessionUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiSession:
    """Sửa title session (chỉ field được gửi mới đổi)."""
    return await _apply_session_update(session_id, payload, current.id)


@router.patch("/{session_id}", response_model=AiSession)
async def patch_ai_session(
    session_id: UUID,
    payload: AiSessionUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiSession:
    """Alias của PUT cho client thích PATCH từng field."""
    return await _apply_session_update(session_id, payload, current.id)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_session(
    session_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa session + toàn bộ messages (DB CASCADE, code xóa messages trước cho chắc)."""
    await _fetch_session(session_id, current.id)
    try:
        # Xóa messages trước để chắc chắn sạch ngay cả khi DB chưa có CASCADE.
        await run_blocking(
            lambda: (
                get_supabase_admin().table(MESSAGE_TABLE).delete().eq(
                    "session_id", str(session_id)
                ).eq("user_id", str(current.id)).execute()
            )
        )
        await run_blocking(
            lambda: (
                get_supabase_admin().table(SESSION_TABLE).delete().eq("id", str(session_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------- Messages (lưu từng lượt nhắn, tiền đề RAG) ----------------


@router.get("/{session_id}/messages", response_model=list[AiMessage])
async def list_ai_messages(
    session_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
    limit: int = Query(default=DEFAULT_MESSAGE_LIMIT, ge=1, le=MAX_MESSAGE_LIMIT),
    offset: int = Query(default=0, ge=0),
) -> list[AiMessage]:
    """Đọc messages của 1 session theo thứ tự thời gian ASC (đủ dựng context RAG)."""
    await _fetch_session(session_id, current.id)
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(MESSAGE_TABLE)
                .select(MESSAGE_COLUMNS)
                .eq("session_id", str(session_id))
                .eq("user_id", str(current.id))
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    rows = list(result.data or [])
    rows.sort(key=lambda row: (str(row.get("created_at", "")), str(row.get("id", ""))))
    return [_to_message(row) for row in rows[offset : offset + limit]]


@router.post("/{session_id}/messages", response_model=AiMessage, status_code=status.HTTP_201_CREATED)
async def create_ai_message(
    session_id: UUID,
    payload: AiMessageCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMessage:
    """Lưu 1 message (role = user | assistant) vào session của mình."""
    await _fetch_session(session_id, current.id)
    content = payload.content.strip()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nội dung tin nhắn không được để trống.",
        )
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(MESSAGE_TABLE)
                .insert(
                    {
                        "session_id": str(session_id),
                        "user_id": str(current.id),
                        "role": payload.role,
                        "content": content,
                    }
                )
                .select(MESSAGE_COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    await _touch_session(session_id, current.id)
    return _to_message(result.data[0])


async def _apply_message_update(
    session_id: UUID, message_id: UUID, payload: AiMessageUpdate, user_id: UUID
) -> AiMessage:
    row = await _fetch_message(message_id, session_id, user_id)
    current = _to_message(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "content" in values and values["content"] is not None:
        values["content"] = str(values["content"]).strip()
        if not values["content"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Nội dung tin nhắn không được để trống.",
            )
    if not values:
        return current
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(MESSAGE_TABLE)
                .update(values)
                .eq("id", str(message_id))
                .eq("session_id", str(session_id))
                .eq("user_id", str(user_id))
                .select(MESSAGE_COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="AI message not found")
    await _touch_session(session_id, user_id)
    return _to_message(result.data[0])


@router.put("/{session_id}/messages/{message_id}", response_model=AiMessage)
async def update_ai_message(
    session_id: UUID,
    message_id: UUID,
    payload: AiMessageUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMessage:
    """Sửa content message (giữ role bất biến)."""
    return await _apply_message_update(session_id, message_id, payload, current.id)


@router.patch("/{session_id}/messages/{message_id}", response_model=AiMessage)
async def patch_ai_message(
    session_id: UUID,
    message_id: UUID,
    payload: AiMessageUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> AiMessage:
    """Alias của PUT message."""
    return await _apply_message_update(session_id, message_id, payload, current.id)


@router.delete("/{session_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ai_message(
    session_id: UUID,
    message_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa 1 message trong session của mình (204)."""
    await _fetch_message(message_id, session_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(MESSAGE_TABLE).delete().eq("id", str(message_id)).eq(
                    "session_id", str(session_id)
                ).eq("user_id", str(current.id)).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    await _touch_session(session_id, current.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
