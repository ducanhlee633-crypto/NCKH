from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str = Field(..., validation_alias="SUPABASE_URL")
    supabase_service_role_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"),
    )
    supabase_anon_key: str | None = Field(default=None, validation_alias="SUPABASE_ANON_KEY")
    # Secret dùng để verify Supabase Auth JWT locally (HS256).
    # Lấy ở Supabase Dashboard > Project Settings > API > JWT Secret.
    # Nếu để trống, backend sẽ verify token bằng cách gọi Supabase Auth API (chậm hơn nhưng vẫn an toàn).
    supabase_jwt_secret: str | None = Field(default=None, validation_alias="SUPABASE_JWT_SECRET")
    auto_confirm_email: bool = Field(default=False, validation_alias="AUTO_CONFIRM_EMAIL")
    # Domain frontend để Supabase dẫn về sau khi user bấm link xác nhận email.
    # Ví dụ: FRONTEND_URL=https://nhip-hoc.vercel.app (local: http://localhost:5173).
    # Phải trùng Site URL / Redirect URLs trong Supabase Dashboard > Authentication > URL Configuration.
    frontend_url: str = Field(default="", validation_alias="FRONTEND_URL")
    # OpenRouter — endpoint tương thích OpenAI (https://openrouter.ai/api/v1).
    # Key chỉ nằm ở backend, không bao giờ lộ ra frontend.
    openrouter_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENROUTER_API_KEY", "OPENROUTER_KEY"),
    )
    openrouter_model: str = Field(
        default="nvidia/nemotron-3.5-lightning:free",
        validation_alias="OPENROUTER_MODEL",
    )
    # Web Push (VAPID). Public key lộ cho frontend subscribe, private key chỉ ở backend.
    vapid_public_key: str | None = Field(default=None, validation_alias="VAPID_PUBLIC_KEY")
    vapid_private_key: str | None = Field(default=None, validation_alias="VAPID_PRIVATE_KEY")
    vapid_subject: str = Field(default="mailto:admin@example.com", validation_alias="VAPID_SUBJECT")

    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent / ".env", extra="ignore")

    @property
    def supabase_key(self) -> str:
        key = self.supabase_service_role_key
        if not key:
            raise ValueError("SUPABASE_SERVICE_ROLE_KEY is required for backend user authentication")
        return key


@lru_cache
def get_settings() -> Settings:
    return Settings()
