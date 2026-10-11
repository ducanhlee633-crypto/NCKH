# Endpoint CRUD cho việc tập trung (PomodoroPage.jsx — ô nhập task).
# Nhẹ, nhanh, không ngày: title + subject (khóa cứng như pomodoro)
# + status (todo|doing|done) + position (thứ tự tay 0..10000).
# - status 'doing' = việc đang bấm giờ (mỗi lúc nên chỉ 1 việc doing,
#   frontend tự chuyển các việc khác về todo khi chọn — backend không ép).
# - Xóa task: pomodoro_sessions.focus_task_id SET NULL, task_title giữ lại.
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import (
    FOCUS_TASK_STATUS_VALUES,
    POMODORO_SUBJECT_VALUES,
    FocusTask,
    FocusTaskCreate,
    FocusTaskUpdate,
)
from subjects import pomodoro_subject_error
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/focus-tasks", tags=["focus-tasks"])

TABLE = "focus_tasks"
COLUMNS = "id,user_id,title,subject,status,position,created_at,updated_at"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _norm_str(value: object) -> str:
    return str(value or "").strip()


def _to_task(row: dict) -> FocusTask:
    data = dict(row)
    if not _norm_str(data.get("title")):
        data["title"] = "Việc chưa đặt tên"
    subject = _norm_str(data.get("subject"))
    data["subject"] = subject if subject in POMODORO_SUBJECT_VALUES else None
    if data.get("status") not in FOCUS_TASK_STATUS_VALUES:
        data["status"] = "todo"
    if data.get("position") is None:
        data["position"] = 0
    else:
        try:
            data["position"] = max(0, min(10000, int(data["position"])))
        except (TypeError, ValueError):
            data["position"] = 0
    return FocusTask.model_validate(data)


async def _fetch_one(task_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("id", str(task_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return result.data[0]


def _matches(row: dict, task_status, subject, query) -> bool:
    if task_status is not None and str(row.get("status")) != task_status:
        return False
    if subject is not None and _norm_str(row.get("subject")) != subject:
        return False
    if query:
        q = query.lower()
        hay = f"{row.get('title') or ''} {row.get('subject') or ''}".lower()
        if q not in hay:
            return False
    return True


def _sort_key(row: dict):
    # Chưa xong trước, đã xong xuống cuối; rồi theo position, id.
    done_last = 1 if str(row.get("status")) == "done" else 0
    try:
        position = int(row.get("position") or 0)
    except (TypeError, ValueError):
        position = 0
    return (done_last, position, str(row.get("created_at") or ""), str(row.get("id")))


@router.get("", response_model=list[FocusTask])
async def list_focus_tasks(
    current: SupabaseUser = Depends(get_current_supabase_user),
    task_status: str | None = Query(default=None, alias="status"),
    subject: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=120),
) -> list[FocusTask]:
    """Liệt kê việc tập trung của chính mình (lọc status/subject/từ khóa)."""
    if task_status is not None and task_status not in FOCUS_TASK_STATUS_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trạng thái phải là todo, doing hoặc done.",
        )
    norm_subject = _norm_str(subject) or None
    if norm_subject is not None and norm_subject not in POMODORO_SUBJECT_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=pomodoro_subject_error(),
        )
    norm_q = _norm_str(q) or None
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
    rows = [
        row
        for row in (result.data or [])
        if _matches(row, task_status, norm_subject, norm_q)
    ]
    rows.sort(key=_sort_key)
    return [_to_task(row) for row in rows]


@router.post("", response_model=FocusTask, status_code=status.HTTP_201_CREATED)
async def create_focus_task(
    payload: FocusTaskCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FocusTask:
    """Thêm việc cần tập trung (ô nhập task ở Phòng tập trung)."""
    values = payload.model_dump(mode="json")
    values["title"] = _norm_str(values.get("title"))
    if not values["title"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy nhập tên việc cần tập trung.",
        )
    subject = _norm_str(values.get("subject"))
    if subject and subject not in POMODORO_SUBJECT_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=pomodoro_subject_error(),
        )
    values["subject"] = subject or None
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
    return _to_task(result.data[0])


@router.get("/{task_id}", response_model=FocusTask)
async def read_focus_task(
    task_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FocusTask:
    """Đọc 1 việc tập trung của chính mình."""
    return _to_task(await _fetch_one(task_id, current.id))


async def _apply_update(task_id: UUID, payload: FocusTaskUpdate, user_id: UUID) -> FocusTask:
    row = await _fetch_one(task_id, user_id)
    current = _to_task(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "title" in values and values["title"] is not None:
        values["title"] = _norm_str(values["title"])
        if not values["title"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hãy nhập tên việc cần tập trung.",
            )
    if "subject" in values:
        subject = _norm_str(values["subject"])
        if subject and subject not in POMODORO_SUBJECT_VALUES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=pomodoro_subject_error(),
            )
        values["subject"] = subject or None
    if not values:
        return current
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .update(values)
                .eq("id", str(task_id))
                .eq("user_id", str(user_id))
                .select(COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return _to_task(result.data[0])


@router.put("/{task_id}", response_model=FocusTask)
async def update_focus_task(
    task_id: UUID,
    payload: FocusTaskUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FocusTask:
    """Sửa việc tập trung (chỉ field được gửi mới đổi)."""
    return await _apply_update(task_id, payload, current.id)


@router.patch("/{task_id}", response_model=FocusTask)
async def patch_focus_task(
    task_id: UUID,
    payload: FocusTaskUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> FocusTask:
    """Alias của PUT — tick/chọn việc chỉ gửi {status} qua endpoint này."""
    return await _apply_update(task_id, payload, current.id)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_focus_task(
    task_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa việc tập trung (204). Phiên pomodoro cũ giữ task_title, focus_task_id về NULL."""
    await _fetch_one(task_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(task_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
