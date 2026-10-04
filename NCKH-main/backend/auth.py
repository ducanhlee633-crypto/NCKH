"""Xác thực bằng Supabase Auth (GoTrue) thay vì tự quản lý password/JWT.

Luồng chuẩn:
- Frontend gọi trực tiếp Supabase Auth (signUp / signInWithPassword) bằng ANON_KEY
  để lấy access_token do Supabase cấp.
- Frontend gửi access_token đó lên FastAPI qua header `Authorization: Bearer <token>`.
- Backend verify token rồi suy ra user id. Backend KHÔNG BAO GIỜ thấy password.
"""

from dataclasses import dataclass
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import get_settings

bearer = HTTPBearer(auto_error=False)


@dataclass
class SupabaseUser:
    id: UUID
    email: str | None = None


def unauthorized(detail: str = "Invalid credentials") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _verify_locally(token: str) -> UUID | None:
    """Verify Supabase JWT bằng JWT secret (HS256). Trả về None nếu không cấu hình được."""
    settings = get_settings()
    secret = settings.supabase_jwt_secret
    if not secret:
        return None
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            options={"require": ["exp", "sub"]},
            # Supabase JWT có aud="authenticated" — chấp nhận cả trường hợp không có aud.
            audience="authenticated",
        )
        return UUID(str(payload["sub"]))
    except jwt.InvalidAudienceError:
        # Thử lại không kiểm tra aud (một số project cấu hình aud khác).
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["exp", "sub"]})
            return UUID(str(payload["sub"]))
        except (jwt.InvalidTokenError, KeyError, ValueError):
            raise unauthorized()
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise unauthorized()


def _verify_via_api(token: str) -> SupabaseUser:
    """Fallback: hỏi Supabase Auth API xem token có hợp lệ không."""
    from supabase_client import get_supabase_admin

    try:
        response = get_supabase_admin().auth.get_user(token)
    except Exception as error:
        raise unauthorized() from error
    user = response.user if hasattr(response, "user") else response.get("user")
    user_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
    email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else None)
    if not user_id:
        raise unauthorized()
    try:
        return SupabaseUser(id=UUID(str(user_id)), email=email)
    except ValueError as error:
        raise unauthorized() from error


def get_current_supabase_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> SupabaseUser:
    if not credentials or credentials.scheme.lower() != "bearer" or not credentials.credentials:
        raise unauthorized()
    token = credentials.credentials
    # Ưu tiên verify local (nhanh, không tốn request). Nếu chưa cấu hình secret thì hỏi API.
    user_id = _verify_locally(token)
    if user_id is not None:
        return SupabaseUser(id=user_id)
    return _verify_via_api(token)


def get_current_user_id(
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> UUID:
    return current.id
