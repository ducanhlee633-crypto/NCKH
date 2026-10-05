# Endpoint CRUD cho mục tiêu (GoalsPage.jsx).
# Mỗi goal 1 dòng: title + target_score (nullable) + icon
# + start_date + end_date + status (in_progress|completed) + progress (0..100).
from datetime import date as va_date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from auth import SupabaseUser, get_current_supabase_user
from schema import GOAL_STATUS_VALUES, Goal, GoalCreate, GoalUpdate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/goals", tags=["goals"])

TABLE = "goals"
COLUMNS = "id,user_id,title,target_score,icon,start_date,end_date,status,progress,created_at,updated_at"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _to_goal(row: dict) -> Goal:
    data = dict(row)
    if not data.get("icon"):
        data["icon"] = "🌱"
    if data.get("status") not in GOAL_STATUS_VALUES:
        data["status"] = "in_progress"
    if data.get("progress") is None:
        data["progress"] = 0
    else:
        try:
            data["progress"] = max(0, min(100, int(data["progress"])))
        except (TypeError, ValueError):
            data["progress"] = 0
    return Goal.model_validate(data)


def _check_dates(start_day: va_date | None, end_day: va_date | None) -> None:
    if start_day and end_day and start_day > end_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày hoàn thành phải từ ngày bắt đầu trở đi.",
        )


def _fetch_one(goal_id: UUID, user_id: UUID) -> dict:
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("id", str(goal_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return result.data[0]


@router.get("", response_model=list[Goal])
def list_goals(
    current: SupabaseUser = Depends(get_current_supabase_user),
    goal_status: str | None = Query(default=None, alias="status"),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
) -> list[Goal]:
    """Liệt kê mục tiêu của chính mình, lọc theo status + khoảng ngày kết thúc."""
    if goal_status is not None and goal_status not in GOAL_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trạng thái phải là in_progress hoặc completed.",
        )
    if from_day and to_day and from_day > to_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'from' phải trước hoặc bằng ngày 'to'.",
        )
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("user_id", str(current.id))
            .execute()
        )
    except Exception as error:
        _db_error(error)
    rows = list(result.data or [])
    if goal_status is not None:
        rows = [row for row in rows if str(row.get("status")) == goal_status]
    if from_day is not None or to_day is not None:
        filtered = []
        for row in rows:
            try:
                day = va_date.fromisoformat(str(row.get("end_date")))
            except ValueError:
                continue
            if from_day is not None and day < from_day:
                continue
            if to_day is not None and day > to_day:
                continue
            filtered.append(row)
        rows = filtered
    rows.sort(key=lambda row: (str(row.get("end_date")), str(row.get("id"))))
    return [_to_goal(row) for row in rows]


@router.post("", response_model=Goal, status_code=status.HTTP_201_CREATED)
def create_goal(
    payload: GoalCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Goal:
    """Tạo mục tiêu mới."""
    _check_dates(payload.start_date, payload.end_date)
    values = payload.model_dump(mode="json")
    values["title"] = values["title"].strip()
    if not values["title"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy nhập tên mục tiêu.",
        )
    values["user_id"] = str(current.id)
    try:
        result = (
            get_supabase_admin().table(TABLE).insert(values).select(COLUMNS).execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_goal(result.data[0])


@router.get("/{goal_id}", response_model=Goal)
def read_goal(
    goal_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Goal:
    """Đọc 1 mục tiêu của chính mình."""
    return _to_goal(_fetch_one(goal_id, current.id))


def _apply_update(goal_id: UUID, payload: GoalUpdate, user_id: UUID) -> Goal:
    row = _fetch_one(goal_id, user_id)
    current = _to_goal(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "title" in values and values["title"] is not None:
        values["title"] = str(values["title"]).strip()
        if not values["title"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hãy nhập tên mục tiêu.",
            )
    if not values:
        return current
    next_start = values.get("start_date", str(current.start_date))
    next_end = values.get("end_date", str(current.end_date))
    try:
        _check_dates(
            va_date.fromisoformat(str(next_start)),
            va_date.fromisoformat(str(next_end)),
        )
    except ValueError:
        pass
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .update(values)
            .eq("id", str(goal_id))
            .eq("user_id", str(user_id))
            .select(COLUMNS)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    return _to_goal(result.data[0])


@router.put("/{goal_id}", response_model=Goal)
def update_goal(
    goal_id: UUID,
    payload: GoalUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Goal:
    """Sửa mục tiêu (chỉ field được gửi mới đổi)."""
    return _apply_update(goal_id, payload, current.id)


@router.patch("/{goal_id}", response_model=Goal)
def patch_goal(
    goal_id: UUID,
    payload: GoalUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Goal:
    """Alias của PUT cho client thích PATCH từng field (VD: đổi status/progress)."""
    return _apply_update(goal_id, payload, current.id)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa mục tiêu (204)."""
    _fetch_one(goal_id, current.id)
    try:
        get_supabase_admin().table(TABLE).delete().eq("id", str(goal_id)).eq(
            "user_id", str(current.id)
        ).execute()
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
