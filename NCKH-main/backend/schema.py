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
