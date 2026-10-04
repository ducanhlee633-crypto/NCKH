from functools import lru_cache

from fastapi import HTTPException
from supabase import Client, create_client

from config import get_settings


@lru_cache
def get_supabase_admin() -> Client:
    """Service-role client: chỉ dùng ở backend, bypass RLS để quản lý profiles."""
    settings = get_settings()
    if not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase backend is not configured: set SUPABASE_SERVICE_ROLE_KEY",
        )
    try:
        return create_client(settings.supabase_url, settings.supabase_key)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Supabase connection could not be initialized") from error


@lru_cache
def get_supabase_anon() -> Client:
    """Anon client: dùng cho sign-in / sign-up qua Supabase Auth (GoTrue)."""
    settings = get_settings()
    if not settings.supabase_anon_key:
        raise HTTPException(
            status_code=503,
            detail="Supabase Auth is not configured: set SUPABASE_ANON_KEY",
        )
    try:
        return create_client(settings.supabase_url, settings.supabase_anon_key)
    except Exception as error:
        raise HTTPException(status_code=503, detail="Supabase connection could not be initialized") from error


# Giữ alias cũ để code/test cũ không vỡ; mặc định trả về admin client.
def get_supabase() -> Client:
    return get_supabase_admin()
