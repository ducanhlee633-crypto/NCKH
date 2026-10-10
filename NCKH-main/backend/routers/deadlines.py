# Endpoint CRUD cho deadline (SchedulePage.jsx).
# Mỗi deadline 1 dòng đơn giản: title + due_date + due_time + priority + status.
# Không lặp lại, không tách chuỗi như schedule_blocks.
from datetime import date as va_date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import Deadline, DeadlineCreate, DeadlineUpdate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/deadlines", tags=["deadlines"])

TABLE = "deadlines"
COLUMNS = "id,user_id,title,due_date,due_time,priority,status,created_at,updated_at"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _norm_time(value: object) -> str:
    # Supabase `time` trả về "23:59:00" — chuẩn hóa về "HH:MM" cho frontend.
    text = str(value or "23:59")
    return text[:5] if len(text) >= 5 else text


def _to_deadline(row: dict) -> Deadline:
    data = dict(row)
    if data.get("due_time") is not None:
        data["due_time"] = _norm_time(data["due_time"])
    # DB cũ chưa có cột status -> mặc định False (chưa hoàn thành).
    if data.get("status") is None:
        data["status"] = False
    else:
        data["status"] = bool(data["status"])
    return Deadline.model_validate(data)


async def _fetch_one(deadline_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("id", str(deadline_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deadline not found")
    return result.data[0]


def _overlaps(row: dict, from_day: va_date | None, to_day: va_date | None) -> bool:
    day = va_date.fromisoformat(str(row["due_date"]))
    return (from_day is None or day >= from_day) and (to_day is None or day <= to_day)


@router.get("", response_model=list[Deadline])
async def list_deadlines(
    current: SupabaseUser = Depends(get_current_supabase_user),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
) -> list[Deadline]:
    """Liệt kê deadline của chính mình, lọc theo khoảng ngày nộp."""
    if from_day and to_day and from_day > to_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'from' phải trước hoặc bằng ngày 'to'.",
        )
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
    rows = [row for row in (result.data or []) if _overlaps(row, from_day, to_day)]
    rows.sort(key=lambda row: (str(row["due_date"]), _norm_time(row.get("due_time")), str(row["id"])))
    return [_to_deadline(row) for row in rows]


@router.post("", response_model=Deadline, status_code=status.HTTP_201_CREATED)
async def create_deadline(
    payload: DeadlineCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Deadline:
    """Tạo deadline mới."""
    values = payload.model_dump(mode="json")
    values["user_id"] = str(current.id)
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).insert(values).select(COLUMNS).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_deadline(result.data[0])


@router.get("/{deadline_id}", response_model=Deadline)
async def read_deadline(
    deadline_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Deadline:
    """Đọc 1 deadline của chính mình."""
    return _to_deadline(await _fetch_one(deadline_id, current.id))


async def _apply_update(deadline_id: UUID, payload: DeadlineUpdate, user_id: UUID) -> Deadline:
    row = await _fetch_one(deadline_id, user_id)
    current = _to_deadline(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if not values:
        return current
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .update(values)
                .eq("id", str(deadline_id))
                .eq("user_id", str(user_id))
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deadline not found")
    return _to_deadline(result.data[0])


@router.put("/{deadline_id}", response_model=Deadline)
async def update_deadline(
    deadline_id: UUID,
    payload: DeadlineUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Deadline:
    """Sửa deadline (chỉ field được gửi mới đổi)."""
    return await _apply_update(deadline_id, payload, current.id)


@router.patch("/{deadline_id}", response_model=Deadline)
async def patch_deadline(
    deadline_id: UUID,
    payload: DeadlineUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Deadline:
    """Alias của PUT cho client thích PATCH từng field."""
    return await _apply_update(deadline_id, payload, current.id)


@router.delete("/{deadline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deadline(
    deadline_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa deadline (204)."""
    await _fetch_one(deadline_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(deadline_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
