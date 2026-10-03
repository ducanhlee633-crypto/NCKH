from datetime import datetime, timedelta, timezone
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from config import get_settings
from schema import Token, UserPrivate, UserPublic

bearer = HTTPBearer(auto_error=False)
password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


@lru_cache
def _jwt_settings() -> tuple[str, str, int]:
    settings = get_settings()
    return settings.jwt_secret_key, settings.jwt_algorithm, settings.jwt_expire_minutes


def _public_user(data: dict) -> UserPublic:
    return UserPublic.model_validate(data)


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def create_access_token(user: UserPrivate) -> Token:
    secret, algorithm, expires_minutes = _jwt_settings()
    expires = timedelta(minutes=expires_minutes)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "iat": now,
        "exp": now + expires,
    }
    return Token(
        access_token=jwt.encode(payload, secret, algorithm=algorithm),
        expires_in=int(expires.total_seconds()),
        user=_public_user(user.model_dump()),
    )


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> UUID:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise unauthorized()
    secret, algorithm, _ = _jwt_settings()
    try:
        payload = jwt.decode(credentials.credentials, secret, algorithms=[algorithm])
        return UUID(str(payload["sub"]))
    except (jwt.InvalidTokenError, KeyError, ValueError):
        raise unauthorized()
