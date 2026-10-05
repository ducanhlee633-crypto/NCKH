# Endpoint lưu lựa chọn Settings của người dùng (SettingsPage.jsx).
# Chỉ nhận 10 field lựa chọn hiển thị/học tập/AI — KHÔNG chứa name/username/nickname/email/grade/password.
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from auth import SupabaseUser, get_current_supabase_user
from schema import AI_TONE_VALUES, UserPreferences, UserPreferencesUpdate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/preferences", tags=["preferences"])

PREFERENCES_TABLE = "user_preferences"
PREFERENCES_COLUMNS = (
    "id,user_id,avatar,theme,color,ranking,streak,reminders,"
    "reminder_minutes,weekly_hours,sound,ai_tone,created_at,updated_at"
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
    "ai_tone": "cute",
}


def _normalize_ai_tone(value: object) -> str:
    tone = str(value or "cute").strip()
    return tone if tone in AI_TONE_VALUES else "cute"


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


def _to_preferences(row: dict | None, user_id: UUID | None = None) -> UserPreferences:
    data = {**DEFAULTS, **(row or {})}
    # DB cũ chưa có cột user_id -> fallback sang cột id (vốn là FK tới auth.users).
    # DB mới có cả hai -> ưu tiên user_id.
    resolved = (row or {}).get("user_id") or (row or {}).get("id") or (str(user_id) if user_id else None)
    if resolved is not None:
        data["user_id"] = resolved
    # DB cũ chưa có cột ai_tone / dữ liệu tay sai giá trị -> chuẩn hóa về default.
    data["ai_tone"] = _normalize_ai_tone(data.get("ai_tone"))
    # DB có thể trả None cho avatar -> giữ None (frontend map sang '').
    return UserPreferences.model_validate(data)


@router.get("/me", response_model=UserPreferences, response_model_by_alias=True)
def read_own_preferences(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> UserPreferences:
    """Đọc lựa chọn Settings của chính mình. Chưa có dòng nào -> trả defaults."""
    return _to_preferences(_fetch_row(current.id), current.id)


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
                return _to_preferences(existing, current.id)
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
            return _to_preferences(result.data[0], current.id)
        merged = {**DEFAULTS, **values, "id": str(current.id), "user_id": str(current.id)}
        result = (
            get_supabase_admin()
            .table(PREFERENCES_TABLE)
            .insert(merged)
            .select(PREFERENCES_COLUMNS)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=503, detail="Database operation failed")
        return _to_preferences(result.data[0], current.id)
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)
