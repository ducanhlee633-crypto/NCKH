# Endpoint CRUD cho góp ý (HelpPage.jsx).
# Mỗi góp ý 1 dòng đơn giản: message (1..2000 ký tự).
# Không sửa — chỉ gửi, xem lại, xóa của chính mình.
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import Feedback, FeedbackCreate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/feedback", tags=["feedback"])

TABLE = "feedbacks"
COLUMNS = "id,user_id,message,created_at,updated_at"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _to_feedback(row: dict) -> Feedback:
    return Feedback.model_validate(row)


async def _fetch_one(feedback_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("id", str(feedback_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    return result.data[0]


@router.get("", response_model=list[Feedback])
async def list_feedback(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> list[Feedback]:
    """Liệt kê góp ý của chính mình (mới nhất trước)."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("user_id", str(current.id))
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    rows = list(result.data or [])
    rows.sort(key=lambda row: (str(row.get("created_at", "")), str(row.get("id", ""))), reverse=True)
    return [_to_feedback(row) for row in rows]


@router.post("", response_model=Feedback, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    payload: FeedbackCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Feedback:
    """Gửi góp ý mới."""
    message = payload.message.strip()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nội dung góp ý không được để trống.",
        )
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .insert({"user_id": str(current.id), "message": message})
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_feedback(result.data[0])


@router.get("/{feedback_id}", response_model=Feedback)
async def read_feedback(
    feedback_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Feedback:
    """Đọc 1 góp ý của chính mình."""
    return _to_feedback(await _fetch_one(feedback_id, current.id))


@router.delete("/{feedback_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feedback(
    feedback_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa góp ý của chính mình (204)."""
    await _fetch_one(feedback_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(feedback_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
