# Endpoint CRUD cho việc trong tuần (WeeklyTasksPage.jsx — kanban todo/doing/done).
# Mỗi task 1 dòng: title + description + subject + date (nullable) + priority + status.
from datetime import date as va_date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from auth import SupabaseUser, get_current_supabase_user
from schema import (
    WEEKLY_TASK_PRIORITY_VALUES,
    WEEKLY_TASK_STATUS_VALUES,
    WeeklyTask,
    WeeklyTaskCreate,
    WeeklyTaskUpdate,
)
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/weekly-tasks", tags=["weekly-tasks"])

TABLE = "weekly_tasks"
COLUMNS = "id,user_id,title,description,subject,date,priority,status,created_at,updated_at"

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


def _to_task(row: dict) -> WeeklyTask:
    data = dict(row)
    if data.get("description") is None:
        data["description"] = ""
    # Chuẩn hóa subject rỗng -> None để khớp Pydantic + frontend.
    if not _norm_str(data.get("subject")):
        data["subject"] = None
    if data.get("priority") not in WEEKLY_TASK_PRIORITY_VALUES:
        data["priority"] = "medium"
    if data.get("status") not in WEEKLY_TASK_STATUS_VALUES:
        data["status"] = "todo"
    return WeeklyTask.model_validate(data)


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


def _matches(row: dict, from_day, to_day, task_status, priority, subject, query) -> bool:
    if task_status is not None and str(row.get("status")) != task_status:
        return False
    if priority is not None and str(row.get("priority")) != priority:
        return False
    if subject is not None and _norm_str(row.get("subject")) != subject:
        return False
    if from_day is not None or to_day is not None:
        raw_date = row.get("date")
        if not raw_date:
            # Chưa hẹn ngày -> luôn giữ lại (khớp logic frontend).
            pass
        else:
            try:
                day = va_date.fromisoformat(str(raw_date))
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
    weight = PRIORITY_WEIGHT.get(str(row.get("priority")), 1)
    # date NULL (chưa hẹn) xếp cuối.
    day = str(row.get("date") or "9999-12-31")
    return (weight, day, str(row.get("id")))


@router.get("", response_model=list[WeeklyTask])
def list_weekly_tasks(
    current: SupabaseUser = Depends(get_current_supabase_user),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
    task_status: str | None = Query(default=None, alias="status"),
    priority: str | None = Query(default=None),
    subject: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
) -> list[WeeklyTask]:
    """Liệt kê việc trong tuần của chính mình, lọc theo khoảng ngày + status/priority/subject/từ khóa."""
    if from_day and to_day and from_day > to_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'from' phải trước hoặc bằng ngày 'to'.",
        )
    if task_status is not None and task_status not in WEEKLY_TASK_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trạng thái phải là todo, doing hoặc done.",
        )
    if priority is not None and priority not in WEEKLY_TASK_PRIORITY_VALUES:
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
        if _matches(row, from_day, to_day, task_status, priority, norm_subject, norm_q)
    ]
    rows.sort(key=_sort_key)
    return [_to_task(row) for row in rows]


@router.post("", response_model=WeeklyTask, status_code=status.HTTP_201_CREATED)
def create_weekly_task(
    payload: WeeklyTaskCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> WeeklyTask:
    """Tạo việc mới trong tuần."""
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


@router.get("/{task_id}", response_model=WeeklyTask)
def read_weekly_task(
    task_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> WeeklyTask:
    """Đọc 1 việc của chính mình."""
    return _to_task(_fetch_one(task_id, current.id))


def _apply_update(task_id: UUID, payload: WeeklyTaskUpdate, user_id: UUID) -> WeeklyTask:
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


@router.put("/{task_id}", response_model=WeeklyTask)
def update_weekly_task(
    task_id: UUID,
    payload: WeeklyTaskUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> WeeklyTask:
    """Sửa việc (chỉ field được gửi mới đổi)."""
    return _apply_update(task_id, payload, current.id)


@router.patch("/{task_id}", response_model=WeeklyTask)
def patch_weekly_task(
    task_id: UUID,
    payload: WeeklyTaskUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> WeeklyTask:
    """Alias của PUT — kéo-thả kanban chỉ gửi {status} qua endpoint này."""
    return _apply_update(task_id, payload, current.id)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_weekly_task(
    task_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa việc (204)."""
    _fetch_one(task_id, current.id)
    try:
        get_supabase_admin().table(TABLE).delete().eq("id", str(task_id)).eq(
            "user_id", str(current.id)
        ).execute()
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
