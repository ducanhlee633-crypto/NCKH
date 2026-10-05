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
    # OpenRouter (chat AI). Key chỉ nằm ở backend, không bao giờ lộ ra frontend.
    openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")
    openrouter_model: str = Field(
        default="nvidia/nemotron-3-super-120b-a12b:free",
        validation_alias="OPENROUTER_MODEL",
    )
    openrouter_site_url: str | None = Field(default=None, validation_alias="OPENROUTER_SITE_URL")
    openrouter_app_name: str | None = Field(default=None, validation_alias="OPENROUTER_APP_NAME")

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
