from datetime import date as va_date
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SignupRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    # Tên thật / username / nickname lưu vào public.profiles (không dùng để đăng nhập).
    name: str = Field(default="", max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    nickname: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


class ResetPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class PasswordChange(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    nickname: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")


class UserPublic(BaseModel):
    """Hồ sơ công khai — chỉ để hiển thị (VD: bạn bè, BXH). KHÔNG chứa name/username/email."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nickname: str | None = None


class UserPrivate(BaseModel):
    """Hồ sơ riêng tư — chỉ chính mình được đọc qua GET/PATCH /users/me."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None = None
    username: str | None = None
    name: str = ""
    nickname: str | None = None
    created_at: datetime
    updated_at: datetime


class SessionUser(BaseModel):
    id: UUID
    email: str | None = None


class UserPreferences(BaseModel):
    """Lựa chọn hiển thị/học tập trong SettingsPage — KHÔNG chứa name/username/nickname/email/grade/password."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    avatar: str | None = Field(default=None, max_length=3_000_000)
    theme: str = Field(default="light", pattern=r"^(light|dark)$")
    color: str = Field(default="blue", pattern=r"^(blue|violet|gold|mint)$")
    ranking: bool = True
    streak: bool = True
    reminders: bool = True
    reminder_minutes: int = Field(default=15, ge=0, le=60, alias="reminderMinutes")
    weekly_hours: int = Field(default=24, ge=1, le=70, alias="weeklyHours")
    sound: bool = True


class UserPreferencesUpdate(BaseModel):
    """PUT /preferences/me — tất cả optional, chỉ cập nhật field được gửi (upsert)."""

    model_config = ConfigDict(populate_by_name=True)

    avatar: str | None = Field(default=None, max_length=3_000_000)
    theme: str | None = Field(default=None, pattern=r"^(light|dark)$")
    color: str | None = Field(default=None, pattern=r"^(blue|violet|gold|mint)$")
    ranking: bool | None = None
    streak: bool | None = None
    reminders: bool | None = None
    reminder_minutes: int | None = Field(default=None, ge=0, le=60, alias="reminderMinutes")
    weekly_hours: int | None = Field(default=None, ge=1, le=70, alias="weeklyHours")
    sound: bool | None = None


class Token(BaseModel):
    """Session do Supabase Auth cấp — backend chỉ relay lại, không tự ký."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: SessionUser
    profile: UserPrivate | None = None


# ---------------- Schedule blocks (SchedulePage.jsx) ----------------
# Lưu 1 dòng cho mỗi chuỗi lặp lại (kiểu Google Calendar): rule repeat nằm
# gọn trong repeat / repeat_days / repeat_until, frontend expand ra các ngày
# khi hiển thị. Xóa/sửa 1 buổi lẻ trong chuỗi dùng exdates + scope=single.

REPEAT_VALUES = ("none", "daily", "weekly", "weekdays", "weekends", "custom", "monthly")

TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$"


class ScheduleBlockBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    subject: str | None = Field(default=None, max_length=80)
    date: va_date
    start_time: str = Field(pattern=TIME_PATTERN)
    end_time: str = Field(pattern=TIME_PATTERN)
    tone: str = Field(default="blue", max_length=20)
    kind: str = Field(default="study", pattern=r"^(study|deadline)$")
    repeat: str = Field(default="none", pattern=r"^(none|daily|weekly|weekdays|weekends|custom|monthly)$")
    repeat_days: list[int] = Field(default_factory=list)
    repeat_until: va_date | None = None


class ScheduleBlockCreate(ScheduleBlockBase):
    pass


class ScheduleBlockUpdate(BaseModel):
    """PUT /schedule/{id} — tất cả optional, chỉ cập nhật field được gửi."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    subject: str | None = Field(default=None, max_length=80)
    date: va_date | None = None
    start_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    end_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    tone: str | None = Field(default=None, max_length=20)
    kind: str | None = Field(default=None, pattern=r"^(study|deadline)$")
    repeat: str | None = Field(default=None, pattern=r"^(none|daily|weekly|weekdays|weekends|custom|monthly)$")
    repeat_days: list[int] | None = None
    repeat_until: va_date | None = None


class ScheduleBlock(BaseModel):
    """Một block học (hoặc một chuỗi lặp lại) của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    subject: str | None = None
    date: va_date
    start_time: str
    end_time: str
    tone: str = "blue"
    kind: str = "study"
    repeat: str = "none"
    repeat_days: list[int] = Field(default_factory=list)
    repeat_until: va_date | None = None
    exdates: list[va_date] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
