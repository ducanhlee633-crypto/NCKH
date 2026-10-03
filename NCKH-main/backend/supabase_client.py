from functools import lru_cache

from fastapi import HTTPException
from supabase import Client, create_client

from config import get_settings


@lru_cache
def get_supabase() -> Client:
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
