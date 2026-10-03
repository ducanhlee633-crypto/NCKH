from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from auth import create_access_token, get_current_user_id, hash_password, unauthorized, verify_password
from schema import LoginRequest, Token, UserCreate, UserPrivate, UserPublic, UserUpdate
from supabase_client import get_supabase

router = APIRouter(prefix="/users", tags=["users"])
auth_router = APIRouter(prefix="/auth", tags=["auth"])
PRIVATE_COLUMNS = "id,username,name,password_hash,created_at,updated_at"
PUBLIC_COLUMNS = "id,username,name,created_at,updated_at"


def _clean_username(value: str) -> str:
    return value.strip().lower()


def _raise_database_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    message = str(error).lower()
    if "duplicate" in message or "unique" in message:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists") from error
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed") from error


def _one(data: list[dict] | None) -> dict:
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return data[0]


def get_private_user(user_id: UUID = Depends(get_current_user_id)) -> UserPrivate:
    try:
        result = get_supabase().table("profile").select(PRIVATE_COLUMNS).eq("id", str(user_id)).limit(1).execute()
    except Exception as error:
        _raise_database_error(error)
    if not result.data:
        raise unauthorized()
    return UserPrivate.model_validate(result.data[0])


@auth_router.post("/login", response_model=Token)
def login(payload: LoginRequest) -> Token:
    try:
        result = (
            get_supabase()
            .table("profile")
            .select(PRIVATE_COLUMNS)
            .eq("username", _clean_username(payload.username))
            .limit(1)
            .execute()
        )
    except Exception as error:
        _raise_database_error(error)
    if not result.data:
        raise unauthorized()
    user = UserPrivate.model_validate(result.data[0])
    if not verify_password(payload.password, user.password_hash):
        raise unauthorized()
    return create_access_token(user)


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate) -> dict:
    try:
        result = get_supabase().table("profile").insert(
            {
                "username": _clean_username(payload.username),
                "name": payload.name.strip(),
                "password_hash": hash_password(payload.password),
            }
        ).execute()
        return _one(result.data)
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)


@router.get("", response_model=list[UserPublic])
def list_users(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    _: UserPrivate = Depends(get_private_user),
) -> list[dict]:
    try:
        result = (
            get_supabase()
            .table("profile")
            .select(PUBLIC_COLUMNS)
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        return result.data or []
    except Exception as error:
        _raise_database_error(error)


@router.get("/{user_id}", response_model=UserPublic)
def get_user(user_id: UUID, current_user: UserPrivate = Depends(get_private_user)) -> dict:
    if user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    try:
        result = get_supabase().table("profile").select(PUBLIC_COLUMNS).eq("id", str(user_id)).limit(1).execute()
        return _one(result.data)
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(user_id: UUID, payload: UserUpdate, current_user: UserPrivate = Depends(get_private_user)) -> dict:
    if user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    values = payload.model_dump(exclude_unset=True)
    if "username" in values:
        values["username"] = _clean_username(values["username"])
    if "name" in values:
        values["name"] = values["name"].strip()
    if "password" in values:
        values["password_hash"] = hash_password(values.pop("password"))
    if not values:
        return get_user(user_id)
    try:
        result = (
            get_supabase()
            .table("profile")
            .update(values)
            .eq("id", str(user_id))
            .select(PUBLIC_COLUMNS)
            .execute()
        )
        return _one(result.data)
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: UUID, current_user: UserPrivate = Depends(get_private_user)) -> None:
    if user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    try:
        result = get_supabase().table("profile").delete().eq("id", str(user_id)).select("id").execute()
        _one(result.data)
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)
