# Endpoint lưu lựa chọn Settings của người dùng (SettingsPage.jsx).
# Chỉ nhận 9 field lựa chọn hiển thị/học tập — KHÔNG chứa name/username/nickname/email/grade/password.
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from auth import SupabaseUser, get_current_supabase_user
from schema import UserPreferences, UserPreferencesUpdate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/preferences", tags=["preferences"])

PREFERENCES_TABLE = "user_preferences"
PREFERENCES_COLUMNS = (
    "id,avatar,theme,color,ranking,streak,reminders,"
    "reminder_minutes,weekly_hours,sound,created_at,updated_at"
)

DEFAULTS: dict = {
    "avatar": None,
    "theme": "light",
    "color": "blue",
    "ranking": True,
    "streak": True,
    "reminders": True,
    "reminder_minutes": 15,
    "weekly_hours": 24,
    "sound": True,
}


def _raise_database_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _fetch_row(user_id: UUID) -> dict | None:
    try:
        result = (
            get_supabase_admin()
            .table(PREFERENCES_TABLE)
            .select(PREFERENCES_COLUMNS)
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        )
    except Exception as error:
        _raise_database_error(error)
    return result.data[0] if result.data else None


def _to_preferences(row: dict | None) -> UserPreferences:
    data = {**DEFAULTS, **(row or {})}
    # DB có thể trả None cho avatar -> giữ None (frontend map sang '').
    return UserPreferences.model_validate(data)


@router.get("/me", response_model=UserPreferences, response_model_by_alias=True)
def read_own_preferences(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> UserPreferences:
    """Đọc lựa chọn Settings của chính mình. Chưa có dòng nào -> trả defaults."""
    return _to_preferences(_fetch_row(current.id))


@router.put("/me", response_model=UserPreferences, response_model_by_alias=True)
def upsert_own_preferences(
    payload: UserPreferencesUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> UserPreferences:
    """Lưu (upsert) lựa chọn Settings của chính mình. Chỉ update field được gửi."""
    values = payload.model_dump(exclude_unset=True, by_alias=False)
    # Bỏ key có giá trị None trừ avatar (cho phép xóa ảnh bằng avatar=null).
    values = {k: v for k, v in values.items() if v is not None or k == "avatar"}
    if "avatar" in values and values["avatar"] is not None and values["avatar"] == "":
        values["avatar"] = None
    existing = _fetch_row(current.id)
    try:
        if existing:
            if not values:
                return _to_preferences(existing)
            result = (
                get_supabase_admin()
                .table(PREFERENCES_TABLE)
                .update(values)
                .eq("id", str(current.id))
                .select(PREFERENCES_COLUMNS)
                .execute()
            )
            if not result.data:
                raise HTTPException(status_code=404, detail="Preferences not found")
            return _to_preferences(result.data[0])
        merged = {**DEFAULTS, **values, "id": str(current.id)}
        result = (
            get_supabase_admin()
            .table(PREFERENCES_TABLE)
            .insert(merged)
            .select(PREFERENCES_COLUMNS)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=503, detail="Database operation failed")
        return _to_preferences(result.data[0])
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)
