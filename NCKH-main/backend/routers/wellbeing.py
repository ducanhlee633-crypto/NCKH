# Endpoint Nhịp học tập: tính Chỉ số Tải học tập (Academic Load Index) bản 4 tín hiệu.
# GET /api/wellbeing/stress — cần đăng nhập, gom dữ liệu của chính mình
#   (deadlines, weekly_tasks, pomodoro_sessions, daily_tasks)
#   rồi gọi services/stress.compute_stress (rule-based, không ML, không chẩn đoán bệnh).
# POST /api/wellbeing/stress/preview — không cần đăng nhập, tính thử từ số liệu
#   frontend gửi lên.
from datetime import date as va_date
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth import SupabaseUser, get_current_supabase_user
from services.stress import compute_stress
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/wellbeing", tags=["wellbeing"])

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")


class StressPreviewRequest(BaseModel):
    deadline_count: int = Field(default=0, ge=0, le=30)
    weekly_pending: int = Field(default=0, ge=0, le=100)
    night_sessions: int = Field(default=0, ge=0, le=50)
    today_pending: int = Field(default=0, ge=0, le=100)


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _parse_day(value: object) -> va_date | None:
    try:
        text = str(value or "")[:10]
        return va_date.fromisoformat(text)
    except ValueError:
        return None


def _parse_moment(value: object) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment
    except ValueError:
        return None


def _vn_hour(moment: datetime) -> int:
    return moment.astimezone(VN_TZ).hour


@router.post("/stress/preview")
def preview_stress(payload: StressPreviewRequest) -> dict:
    """Tính thử điểm tải từ số liệu thủ công (không cần đăng nhập)."""
    result = compute_stress(
        deadline_count=payload.deadline_count,
        weekly_pending=payload.weekly_pending,
        night_sessions=payload.night_sessions,
        today_pending=payload.today_pending,
    )
    return {**result, "mode": "preview"}


@router.get("/stress")
def my_stress(current: SupabaseUser = Depends(get_current_supabase_user)) -> dict:
    """Tính điểm tải của chính mình từ dữ liệu thật."""
    today = datetime.now(timezone.utc).date()
    week_ago = today - timedelta(days=7)
    user_id = str(current.id)
    try:
        db = get_supabase_admin()
        deadlines = (db.table("deadlines").select("due_date,status").eq("user_id", user_id).execute().data or [])
        weekly = (db.table("weekly_tasks").select("date,status").eq("user_id", user_id).execute().data or [])
        pomodoros = (db.table("pomodoro_sessions").select("started_at").eq("user_id", user_id).execute().data or [])
        daily = (db.table("daily_tasks").select("task_date,done").eq("user_id", user_id).execute().data or [])
    except Exception as error:
        _db_error(error)

    # D: deadline chưa xong — trễ hạn + 7 ngày tới (mỗi cái tính như nhau).
    deadline_count = 0
    for row in deadlines:
        day = _parse_day(row.get("due_date"))
        if day is None or bool(row.get("status")):
            continue
        delta = (day - today).days
        if delta <= 7:
            deadline_count += 1

    # W: weekly task chưa xong 7 ngày qua (todo/doing; chưa hẹn ngày tính vào hôm nay).
    weekly_pending = 0
    for row in weekly:
        day = _parse_day(row.get("date")) if row.get("date") else today
        if day is None or day < week_ago or day > today:
            continue
        if str(row.get("status")) != "done":
            weekly_pending += 1

    # N: số buổi bắt đầu từ 22h trở đi (giờ VN) trong 7 ngày qua.
    night_sessions = 0
    for row in pomodoros:
        moment = _parse_moment(row.get("started_at"))
        if moment is None:
            continue
        day = moment.date()
        if day < week_ago or day > today:
            continue
        if _vn_hour(moment) >= 22:
            night_sessions += 1

    # T: task trong ngày hôm nay chưa xong.
    today_pending = 0
    for row in daily:
        day = _parse_day(row.get("task_date"))
        if day is None or day != today:
            continue
        if not row.get("done"):
            today_pending += 1

    result = compute_stress(
        deadline_count=deadline_count,
        weekly_pending=weekly_pending,
        night_sessions=night_sessions,
        today_pending=today_pending,
    )
    return {
        **result,
        "mode": "personal",
        "inputs": {
            "deadline_count": deadline_count,
            "weekly_pending": weekly_pending,
            "night_sessions": night_sessions,
            "today_pending": today_pending,
        },
    }
