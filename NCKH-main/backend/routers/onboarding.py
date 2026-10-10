# Onboarding chỉ cho tài khoản MỚI sau đăng ký (OnboardingPage.jsx).
# Tài khoản CŨ (tạo trước ngày ra mắt onboarding) được bỏ qua, không bắt trả lời lại.
# Luồng tài khoản mới: hỏi lớp -> ít nhất 3 mục tiêu năm học (chi tiết) -> giọng AI -> giờ học/tuần.
# Lưu vào từng bảng có sẵn: grade -> profiles.grade, goals -> bảng goals,
# ai_tone + weekly_hours -> user_preferences. Không tạo bảng/cột mới.
# Resume: GET /onboarding/status suy ra bước dở từ dữ liệu thiếu trên DB,
# tài khoản mới thoát giữa chừng thì vào lại vẫn mở đúng bước dở.
from datetime import date as va_date
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import AI_TONE_VALUES, GRADE_VALUES
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

PROFILES_TABLE = "profiles"
GOALS_TABLE = "goals"
PREFERENCES_TABLE = "user_preferences"

GRADE_SET = set(GRADE_VALUES)
AI_TONE_SET = set(AI_TONE_VALUES)

# Tài khoản tạo trước ngày này được coi là tài khoản CŨ -> bỏ qua onboarding.
# Tài khoản mới (đăng ký sau ngày này) bắt buộc làm onboarding tới khi xong.
ONBOARDING_LAUNCH_DATE = va_date(2026, 10, 6)


class OnboardingGoalInput(BaseModel):
    """1 mục tiêu trong onboarding — chi tiết như GoalsPage (title + điểm + icon + ngày)."""

    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    target_score: float | None = Field(default=None, ge=0, le=10)
    icon: str = Field(default="🌱", min_length=1, max_length=16)
    start_date: va_date
    end_date: va_date


class OnboardingCompleteRequest(BaseModel):
    """POST /onboarding/complete — lưu toàn bộ 4 nhóm vào từng bảng."""

    model_config = ConfigDict(populate_by_name=True)

    grade: str = Field(pattern=r"^(6|7|8|9|10|11|12)$")
    ai_tone: str = Field(pattern=r"^(cute|honest|funny|empathetic)$")
    weekly_hours: int = Field(ge=1, le=70)
    goals: list[OnboardingGoalInput] = Field(min_length=3, max_length=20)


class OnboardingStatus(BaseModel):
    """Trạng thái onboarding suy từ DB — completed=True thì được vào app."""

    grade: str | None = None
    goals_count: int = 0
    has_preferences: bool = False
    ai_tone: str | None = None
    weekly_hours: int | None = None
    completed: bool = False
    missing: list[str] = Field(default_factory=list)
    next_step: str = "grade"


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


async def _fetch_profile(user_id: UUID) -> dict | None:
    """Đọc profiles (grade + created_at), fallback None nếu DB cũ chưa có cột grade."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(PROFILES_TABLE)
                .select("id,grade,created_at")
                .eq("id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        message = str(error).lower()
        if "grade" in message and ("column" in message or "schema" in message or "42703" in message):
            return None
        _db_error(error)
    rows = result.data or []
    return rows[0] if rows else None


def _is_old_account(profile: dict | None) -> bool:
    """Tài khoản cũ = created_at trước ngày ra mắt onboarding -> bỏ qua, không bắt làm."""
    if not profile or not profile.get("created_at"):
        return False
    try:
        raw = str(profile["created_at"])
        created = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return created.date() < ONBOARDING_LAUNCH_DATE
    except (ValueError, TypeError):
        return False


async def _fetch_grade(user_id: UUID) -> str | None:
    """Đọc profiles.grade, fallback None nếu DB cũ chưa có cột grade."""
    profile = await _fetch_profile(user_id)
    if not profile:
        return None
    grade = profile.get("grade")
    return grade if grade in GRADE_SET else None


async def _fetch_goals_count(user_id: UUID) -> int:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(GOALS_TABLE)
                .select("id")
                .eq("user_id", str(user_id))
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return len(result.data or [])


async def _fetch_preferences(user_id: UUID) -> dict | None:
    """Trả row preferences nếu đã có dòng (tức user đã chọn giọng/giờ ở onboarding hoặc Settings)."""
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(PREFERENCES_TABLE)
                .select("id,user_id,ai_tone,weekly_hours")
                .eq("id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    rows = result.data or []
    return rows[0] if rows else None


async def _build_status(user_id: UUID) -> OnboardingStatus:
    import asyncio

    profile = await _fetch_profile(user_id)
    # Tài khoản cũ: bỏ qua onboarding, cho vào app luôn.
    if _is_old_account(profile):
        grade = profile.get("grade") if profile else None
        grade = grade if grade in GRADE_SET else None
        goals_count, prefs = await asyncio.gather(
            _fetch_goals_count(user_id), _fetch_preferences(user_id)
        )
        return OnboardingStatus(
            grade=grade,
            goals_count=goals_count,
            has_preferences=prefs is not None,
            ai_tone=None,
            weekly_hours=None,
            completed=True,
            missing=[],
            next_step="done",
        )
    grade = profile.get("grade") if profile else None
    grade = grade if grade in GRADE_SET else None
    goals_count, prefs = await asyncio.gather(
        _fetch_goals_count(user_id), _fetch_preferences(user_id)
    )
    has_preferences = prefs is not None
    ai_tone = prefs.get("ai_tone") if prefs else None
    weekly_hours = prefs.get("weekly_hours") if prefs else None
    if ai_tone not in AI_TONE_SET:
        ai_tone = None
    try:
        weekly_hours = int(weekly_hours) if weekly_hours is not None else None
    except (TypeError, ValueError):
        weekly_hours = None
    if weekly_hours is not None and not 1 <= weekly_hours <= 70:
        weekly_hours = None
    # preferences được tính là xong khi đã có dòng (dù giá trị có là default).
    # Giá trị chi tiết trả về để frontend prefill; thiếu dòng mới tính là chưa xong.
    missing: list[str] = []
    if grade is None:
        missing.append("grade")
    if goals_count < 3:
        missing.append("goals")
    if not has_preferences:
        missing.append("preferences")
    order = ["grade", "goals", "preferences"]
    next_step = next((key for key in order if key in missing), "done")
    return OnboardingStatus(
        grade=grade,
        goals_count=goals_count,
        has_preferences=has_preferences,
        ai_tone=ai_tone if has_preferences else None,
        weekly_hours=weekly_hours if has_preferences else None,
        completed=not missing,
        missing=missing,
        next_step=next_step,
    )


@router.get("/status", response_model=OnboardingStatus)
async def read_onboarding_status(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> OnboardingStatus:
    """Cho App.jsx biết user đã xong onboarding chưa + đang dở ở bước nào."""
    return await _build_status(current.id)


@router.post("/complete", response_model=OnboardingStatus)
async def complete_onboarding(
    payload: OnboardingCompleteRequest,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> OnboardingStatus:
    """Lưu toàn bộ onboarding vào từng bảng: grade, goals (≥3), ai_tone + weekly_hours."""
    # Validate chi tiết từng goal (Pydantic đã check type; ở đây check nội dung).
    cleaned_goals: list[dict] = []
    for item in payload.goals:
        title = item.title.strip()
        if not title:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Hãy nhập tên cho cả 3 mục tiêu.",
            )
        if item.start_date > item.end_date:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ngày hoàn thành phải từ ngày bắt đầu trở đi.",
            )
        icon = (item.icon or "🌱").strip() or "🌱"
        cleaned_goals.append(
            {
                "user_id": str(current.id),
                "title": title,
                "target_score": item.target_score,
                "icon": icon,
                "start_date": item.start_date.isoformat(),
                "end_date": item.end_date.isoformat(),
                "status": "in_progress",
                "progress": 0,
            }
        )

    # 1. Lớp -> profiles.grade
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(PROFILES_TABLE).update({"grade": payload.grade}).eq(
                    "id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        message = str(error).lower()
        missing_grade = "grade" in message and ("column" in message or "schema" in message or "42703" in message)
        if missing_grade:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Chưa có cột grade trong bảng profiles. Hãy chạy migration trong backend/supabase/schema.sql rồi thử lại.",
            ) from error
        _db_error(error)

    # 2. Giọng AI + giờ học -> user_preferences (upsert giữ các field khác).
    try:
        existing = await _fetch_preferences(current.id)
        if existing:
            await run_blocking(
                lambda: (
                    get_supabase_admin().table(PREFERENCES_TABLE).update(
                        {"ai_tone": payload.ai_tone, "weekly_hours": payload.weekly_hours}
                    ).eq("id", str(current.id)).execute()
                )
            )
        else:
            await run_blocking(
                lambda: (
                    get_supabase_admin().table(PREFERENCES_TABLE).insert(
                        {
                            "id": str(current.id),
                            "user_id": str(current.id),
                            "avatar": None,
                            "theme": "light",
                            "color": "blue",
                            "ranking": True,
                            "streak": True,
                            "reminders": True,
                            "reminder_minutes": 15,
                            "weekly_hours": payload.weekly_hours,
                            "sound": True,
                            "ai_tone": payload.ai_tone,
                        }
                    ).execute()
                )
            )
    except Exception as error:
        _db_error(error)

    # 3. Mục tiêu -> bảng goals. Nếu đã có ≥3 (retry/reload) thì bỏ qua để không nhân bản.
    try:
        current_count = await _fetch_goals_count(current.id)
        if current_count < 3:
            await run_blocking(
                lambda: (
                    get_supabase_admin().table(GOALS_TABLE).insert(cleaned_goals).execute()
                )
            )
    except Exception as error:
        _db_error(error)

    return await _build_status(current.id)
