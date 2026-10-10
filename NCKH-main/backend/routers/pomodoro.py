# Endpoint cho phiên focus đã hoàn thành (PomodoroPage.jsx).
# Gọn nhẹ: mỗi phiên 1 dòng — focus_minutes + started_at/ended_at + subject.
# Subject khóa cứng theo subjects.POMODORO_SUBJECT_VALUES (None = không chọn môn).
# Chỉ lưu phiên focus đã chạy hết giờ; không lưu phiên đang chạy / nghỉ / hủy.
# Không sửa — chỉ ghi, xem lại, xem thống kê, xóa của chính mình.
from datetime import date as va_date
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import (
    POMODORO_SUBJECT_VALUES,
    PomodoroDaySummary,
    PomodoroSession,
    PomodoroSessionCreate,
    PomodoroSummary,
)
from subjects import pomodoro_subject_error
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/pomodoro", tags=["pomodoro"])

TABLE = "pomodoro_sessions"
COLUMNS = "id,user_id,focus_minutes,subject,started_at,ended_at,created_at,updated_at"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _to_session(row: dict) -> PomodoroSession:
    data = dict(row)
    if data.get("subject") is not None:
        text = str(data["subject"]).strip()
        data["subject"] = text or None
    return PomodoroSession.model_validate(data)


def _validate_payload(payload: PomodoroSessionCreate) -> dict:
    subject = (payload.subject or "").strip() or None
    if subject is not None and subject not in POMODORO_SUBJECT_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=pomodoro_subject_error(),
        )
    if payload.ended_at <= payload.started_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thời gian kết thúc phải sau thời gian bắt đầu.",
        )
    now = datetime.now(timezone.utc)
    # Chặn dữ liệu tương lai quá xa (sai giờ máy) và quá khứ quá xa.
    if payload.started_at > now + timedelta(minutes=5):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thời gian bắt đầu không thể ở tương lai.",
        )
    if payload.ended_at > now + timedelta(minutes=5):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Thời gian kết thúc không thể ở tương lai.",
        )
    if payload.started_at < now - timedelta(days=30):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chỉ ghi phiên trong 30 ngày gần đây.",
        )
    return {
        "focus_minutes": payload.focus_minutes,
        "subject": subject,
        "started_at": payload.started_at.isoformat(),
        "ended_at": payload.ended_at.isoformat(),
    }


async def _fetch_one(session_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(TABLE)
                .select(COLUMNS)
                .eq("id", str(session_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pomodoro session not found")
    return result.data[0]


def _session_day(row: dict) -> va_date:
    raw = str(row.get("started_at") or row.get("created_at") or "")
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return va_date.fromisoformat(raw[:10])


@router.get("", response_model=list[PomodoroSession])
async def list_sessions(
    current: SupabaseUser = Depends(get_current_supabase_user),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
) -> list[PomodoroSession]:
    """Liệt kê phiên focus đã hoàn thành của chính mình, lọc theo ngày bắt đầu."""
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
    rows = list(result.data or [])
    if from_day or to_day:
        rows = [
            row
            for row in rows
            if (from_day is None or _session_day(row) >= from_day)
            and (to_day is None or _session_day(row) <= to_day)
        ]
    rows.sort(key=lambda row: (str(row.get("started_at", "")), str(row.get("id", ""))))
    return [_to_session(row) for row in rows]


@router.get("/summary", response_model=PomodoroSummary)
async def session_summary(
    current: SupabaseUser = Depends(get_current_supabase_user),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
) -> PomodoroSummary:
    """Tổng phút + số phiên trong khoảng ngày (mặc định: hôm nay, theo UTC)."""
    today = datetime.now(timezone.utc).date()
    start = from_day or today
    end = to_day or today
    if start > end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'from' phải trước hoặc bằng ngày 'to'.",
        )
    sessions = await list_sessions(current, start, end)
    by_day: dict[va_date, dict[str, int]] = {}
    for session in sessions:
        day = _session_day({"started_at": session.started_at.isoformat()})
        # Giữ đúng khoảng đã lọc (tránh lệch múi giờ khi parse lại).
        if day < start or day > end:
            continue
        bucket = by_day.setdefault(day, {"total_minutes": 0, "total_sessions": 0})
        bucket["total_minutes"] += session.focus_minutes
        bucket["total_sessions"] += 1
    days = [
        PomodoroDaySummary(date=day, total_minutes=bucket["total_minutes"], total_sessions=bucket["total_sessions"])
        for day, bucket in sorted(by_day.items())
    ]
    return PomodoroSummary(
        total_minutes=sum(day.total_minutes for day in days),
        total_sessions=sum(day.total_sessions for day in days),
        days=days,
    )


@router.post("", response_model=PomodoroSession, status_code=status.HTTP_201_CREATED)
async def create_session(
    payload: PomodoroSessionCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> PomodoroSession:
    """Ghi 1 phiên focus đã hoàn thành (timer chạy hết giờ mới gọi)."""
    values = _validate_payload(payload)
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
    return _to_session(result.data[0])


@router.get("/{session_id}", response_model=PomodoroSession)
async def read_session(
    session_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> PomodoroSession:
    """Đọc 1 phiên của chính mình."""
    return _to_session(await _fetch_one(session_id, current.id))


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> Response:
    """Xóa 1 phiên của chính mình (204)."""
    await _fetch_one(session_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(TABLE).delete().eq("id", str(session_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
