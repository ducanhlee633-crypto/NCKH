from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SignupRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    # Tên hiển thị / username lưu vào public.profiles (không dùng để đăng nhập).
    name: str = Field(default="", max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")


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


class UserPublic(BaseModel):
    """Hồ sơ công khai — ánh xạ từ public.profiles, KHÔNG chứa password."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str | None = None
    name: str = ""
    created_at: datetime
    updated_at: datetime


class SessionUser(BaseModel):
    id: UUID
    email: str | None = None


class Token(BaseModel):
    """Session do Supabase Auth cấp — backend chỉ relay lại, không tự ký."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: SessionUser
    profile: UserPublic | None = None
