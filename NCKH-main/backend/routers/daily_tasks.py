# Endpoint CRUD cho việc hằng ngày (DashboardPage.jsx — "Việc cần làm").
# Mỗi task 1 dòng: title + description + subject + task_date (bắt buộc)
# + priority (high|medium|low) + done (bool) + position (thứ tự tay 0..10000).
# task_date bắt buộc để Dashboard lọc "hôm nay" / ngày khác.
from datetime import date as va_date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from auth import SupabaseUser, get_current_supabase_user
from schema import (
    DAILY_TASK_PRIORITY_VALUES,
    DailyTask,
    DailyTaskCreate,
    DailyTaskUpdate,
)
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/daily-tasks", tags=["daily-tasks"])

TABLE = "daily_tasks"
COLUMNS = "id,user_id,title,description,subject,task_date,priority,done,position,created_at,updated_at"

PRIORITY_WEIGHT = {"high": 0, "medium": 1, "low": 2}


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _norm_str(value: object) -> str:
    return str(value or "").strip()


def _to_task(row: dict) -> DailyTask:
    data = dict(row)
    if data.get("description") is None:
        data["description"] = ""
    # Chuẩn hóa subject rỗng -> None để khớp Pydantic + frontend.
    if not _norm_str(data.get("subject")):
        data["subject"] = None
    if data.get("priority") not in DAILY_TASK_PRIORITY_VALUES:
        data["priority"] = "medium"
    if data.get("done") is None:
        data["done"] = False
    else:
        data["done"] = bool(data["done"])
    if data.get("position") is None:
        data["position"] = 0
    else:
        try:
            data["position"] = max(0, min(10000, int(data["position"])))
        except (TypeError, ValueError):
            data["position"] = 0
    return DailyTask.model_validate(data)


def _fetch_one(task_id: UUID, user_id: UUID) -> dict:
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("id", str(task_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return result.data[0]


def _matches(row: dict, from_day, to_day, priority, done, subject, query) -> bool:
    if priority is not None and str(row.get("priority")) != priority:
        return False
    if done is not None and bool(row.get("done")) != done:
        return False
    if subject is not None and _norm_str(row.get("subject")) != subject:
        return False
    raw_date = row.get("task_date")
    if from_day is not None or to_day is not None:
        if not raw_date:
            return False
        try:
            day = va_date.fromisoformat(str(raw_date)[:10])
        except ValueError:
            return False
        if from_day is not None and day < from_day:
            return False
        if to_day is not None and day > to_day:
            return False
    if query:
        q = query.lower()
        hay = f"{row.get('title') or ''} {row.get('description') or ''}".lower()
        if q not in hay:
            return False
    return True


def _sort_key(row: dict):
    day = str(row.get("task_date") or "9999-12-31")[:10]
    weight = PRIORITY_WEIGHT.get(str(row.get("priority")), 1)
    try:
        position = int(row.get("position") or 0)
    except (TypeError, ValueError):
        position = 0
    return (day, weight, position, str(row.get("id")))


@router.get("", response_model=list[DailyTask])
def list_daily_tasks(
    current: SupabaseUser = Depends(get_current_supabase_user),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
    priority: str | None = Query(default=None),
    done: bool | None = Query(default=None),
    subject: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
) -> list[DailyTask]:
    """Liệt kê việc hằng ngày của chính mình, lọc theo ngày + priority/done/subject/từ khóa."""
    if from_day and to_day and from_day > to_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'from' phải trước hoặc bằng ngày 'to'.",
        )
    if priority is not None and priority not in DAILY_TASK_PRIORITY_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mức ưu tiên phải là high, medium hoặc low.",
        )
    norm_subject = _norm_str(subject) or None
    norm_q = _norm_str(q) or None
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
    rows = [
        row
        for row in (result.data or [])
        if _matches(row, from_day, to_day, priority, done, norm_subject, norm_q)
    ]
    rows.sort(key=_sort_key)
    return [_to_task(row) for row in rows]


@router.post("", response_model=DailyTask, status_code=status.HTTP_201_CREATED)
def create_daily_task(
    payload: DailyTaskCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> DailyTask:
    """Tạo việc hằng ngày mới."""
    values = payload.model_dump(mode="json")
    values["title"] = _norm_str(values.get("title"))
    if not values["title"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy nhập tên việc cần làm.",
        )
    values["description"] = _norm_str(values.get("description"))
    subject = _norm_str(values.get("subject"))
    values["subject"] = subject or None
    values["user_id"] = str(current.id)
    try:
        result = (
            get_supabase_admin().table(TABLE).insert(values).select(COLUMNS).execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_task(result.data[0])


@router.get("/{task_id}", response_model=DailyTask)
def read_daily_task(
    task_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> DailyTask:
    """Đọc 1 việc hằng ngày của chính mình."""
    return _to_task(_fetch_one(task_id, current.id))


def _apply_update(task_id: UUID, payload: DailyTaskUpdate, user_id: UUID) -> DailyTask:
    row = _fetch_one(task_id, user_id)
    current = _to_task(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "title" in values and values["title"] is not None:
        values["title"] = _norm_str(values["title"])
        if not values["title"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hãy nhập tên việc cần làm.",
            )
    if "description" in values and values["description"] is not None:
        values["description"] = _norm_str(values["description"])
    if "subject" in values:
        subject = _norm_str(values["subject"])
        values["subject"] = subject or None
    if not values:
        return current
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .update(values)
            .eq("id", str(task_id))
            .eq("user_id", str(user_id))
            .select(COLUMNS)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return _to_task(result.data[0])


@router.put("/{task_id}", response_model=DailyTask)
def update_daily_task(
    task_id: UUID,
    payload: DailyTaskUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> DailyTask:
    """Sửa việc hằng ngày (chỉ field được gửi mới đổi)."""
    return _apply_update(task_id, payload, current.id)


@router.patch("/{task_id}", response_model=DailyTask)
def patch_daily_task(
    task_id: UUID,
    payload: DailyTaskUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> DailyTask:
    """Alias của PUT — tick checkbox chỉ gửi {done} qua endpoint này."""
    return _apply_update(task_id, payload, current.id)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_daily_task(
    task_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa việc hằng ngày (204)."""
    _fetch_one(task_id, current.id)
    try:
        get_supabase_admin().table(TABLE).delete().eq("id", str(task_id)).eq(
            "user_id", str(current.id)
        ).execute()
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
