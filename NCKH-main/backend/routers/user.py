from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from auth import SupabaseUser, get_current_supabase_user, unauthorized
from config import get_settings
from schema import (
    GRADE_VALUES,
    LoginRequest,
    PasswordChange,
    ProfileUpdate,
    RefreshRequest,
    ResetPasswordRequest,
    SessionUser,
    SignupRequest,
    Token,
    UserPrivate,
    UserPublic,
)
from supabase_client import get_supabase_admin, get_supabase_anon

router = APIRouter(prefix="/users", tags=["users"])
auth_router = APIRouter(prefix="/auth", tags=["auth"])

PROFILE_COLUMNS = "id,username,name,nickname,grade,created_at,updated_at"
# Fallback cho DB cũ chưa chạy migration thêm cột grade.
PROFILE_COLUMNS_LEGACY = "id,username,name,nickname,created_at,updated_at"
PROFILES_TABLE = "profiles"


def _clean_username(value: str) -> str:
    return value.strip().lower()


def _clean_nickname(value: str) -> str:
    # Nickname validate chặt như username: 3-64, [A-Za-z0-9_.-], unique, lowercase.
    return value.strip().lower()


def _clean_grade(value: str | None) -> str | None:
    """Chuẩn hóa lớp: None/""/khoảng trắng -> None (xóa), "6".."12" -> giữ, còn lại -> ValueError."""
    if value is None:
        return None
    cleaned = str(value).strip()
    if not cleaned:
        return None
    if cleaned not in GRADE_VALUES:
        raise ValueError(f"Grade must be one of {', '.join(GRADE_VALUES)}")
    return cleaned


def _raise_database_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    message = str(error).lower()
    if "duplicate" in message or "unique" in message:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username or nickname already exists"
        ) from error
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed") from error


def _one(data: list[dict] | None) -> dict:
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    return data[0]


def _supabase_error_status(error: Exception) -> tuple[int, str]:
    """Map lỗi GoTrue sang HTTP status + message an toàn (không lộ chi tiết nội bộ)."""
    message = str(error).lower()
    if "invalid login credentials" in message or "invalid_grant" in message or "email not confirmed" in message:
        if "email not confirmed" in message or "email not confirmed" in message:
            return status.HTTP_401_UNAUTHORIZED, "Email chưa được xác nhận. Vui lòng kiểm tra hộp thư."
        return status.HTTP_401_UNAUTHORIZED, "Email hoặc mật khẩu không đúng."
    if "user already registered" in message or "already registered" in message or "already exists" in message:
        return status.HTTP_409_CONFLICT, "Email đã được đăng ký."
    if "password" in message and ("weak" in message or "short" in message or "length" in message):
        return status.HTTP_422_UNPROCESSABLE_ENTITY, "Mật khẩu quá yếu (tối thiểu 8 ký tự)."
    if "rate limit" in message or "too many" in message:
        return status.HTTP_429_TOO_MANY_REQUESTS, "Thử quá nhiều lần. Vui lòng đợi rồi thử lại."
    return status.HTTP_400_BAD_REQUEST, "Không thể hoàn tất yêu cầu."


def _fetch_profile(user_id: UUID) -> dict | None:
    try:
        result = (
            get_supabase_admin()
            .table(PROFILES_TABLE)
            .select(PROFILE_COLUMNS)
            .eq("id", str(user_id))
            .limit(1)
            .execute()
        )
    except Exception as error:
        # DB cũ chưa có cột grade (chưa chạy migration): fallback đọc cột cũ.
        message = str(error).lower()
        if "grade" in message and ("column" in message or "schema" in message or "42703" in message):
            try:
                result = (
                    get_supabase_admin()
                    .table(PROFILES_TABLE)
                    .select(PROFILE_COLUMNS_LEGACY)
                    .eq("id", str(user_id))
                    .limit(1)
                    .execute()
                )
            except Exception as legacy_error:
                _raise_database_error(legacy_error)
        else:
            _raise_database_error(error)
    row = result.data[0] if result.data else None
    if row is not None and "grade" not in row:
        row["grade"] = None
    return row


def _ensure_profile(
    user_id: UUID,
    username: str | None,
    name: str,
    nickname: str | None = None,
    grade: str | None = None,
) -> dict:
    """Lấy profile theo auth id; tự tạo nếu trigger handle_new_user chưa kịp chạy."""
    existing = _fetch_profile(user_id)
    if existing:
        return existing
    values: dict = {"id": str(user_id), "name": (name or "").strip()}
    if username:
        values["username"] = _clean_username(username)
    if nickname:
        values["nickname"] = _clean_nickname(nickname)
    if grade:
        values["grade"] = _clean_grade(grade)
    try:
        try:
            result = get_supabase_admin().table(PROFILES_TABLE).insert(values).select(PROFILE_COLUMNS).execute()
        except Exception as insert_error:
            # DB cũ chưa có cột grade: thử lại không kèm grade.
            message = str(insert_error).lower()
            if "grade" in message and "grade" in values:
                values.pop("grade", None)
                result = (
                    get_supabase_admin().table(PROFILES_TABLE).insert(values).select(PROFILE_COLUMNS_LEGACY).execute()
                )
            else:
                raise
        return _one(result.data)
    except Exception as error:
        # Có thể trigger đã tạo song song -> đọc lại lần nữa trước khi báo lỗi.
        retry = _fetch_profile(user_id)
        if retry:
            return retry
        _raise_database_error(error)
        raise  # pragma: no cover


def _to_private(row: dict, email: str | None = None) -> UserPrivate:
    data = dict(row)
    if email is not None:
        data["email"] = email
    # DB cũ chưa có cột grade -> mặc định None để UserPrivate vẫn validate được.
    if "grade" not in data:
        data["grade"] = None
    return UserPrivate.model_validate(data)


def _to_public(row: dict) -> UserPublic:
    return UserPublic.model_validate(row)


def get_current_profile(current: SupabaseUser = Depends(get_current_supabase_user)) -> UserPrivate:
    row = _fetch_profile(current.id)
    if not row:
        # Tài khoản Auth tồn tại nhưng chưa có profile (VD: tắt trigger) -> tạo placeholder.
        row = _ensure_profile(current.id, None, "")
    return _to_private(row, current.email)


def _to_token(session, profile_row: dict | None) -> Token:
    user = session.user if hasattr(session, "user") else session.get("user")
    uid = getattr(user, "id", None) or user.get("id")
    email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else None)
    profile = _to_private(profile_row, email) if profile_row else None
    return Token(
        access_token=session.access_token if hasattr(session, "access_token") else session.get("access_token"),
        refresh_token=getattr(session, "refresh_token", None) or session.get("refresh_token"),
        expires_in=getattr(session, "expires_in", None) or session.get("expires_in"),
        user=SessionUser(id=UUID(str(uid)), email=email),
        profile=profile,
    )


# ---------------- Auth (ủy thác hoàn toàn cho Supabase Auth) ----------------


@auth_router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest) -> Token:
    username = _clean_username(payload.username) if payload.username else None
    nickname = _clean_nickname(payload.nickname) if payload.nickname else None
    grade = _clean_grade(payload.grade) if payload.grade else None
    try:
        response = get_supabase_anon().auth.sign_up(
            {
                "email": payload.email.strip(),
                "password": payload.password,
                "options": {
                    "data": {
                        "username": username,
                        "name": payload.name.strip(),
                        "nickname": nickname,
                        "grade": grade,
                    }
                },
            }
        )
    except HTTPException:
        raise
    except Exception as error:
        code, detail = _supabase_error_status(error)
        raise HTTPException(status_code=code, detail=detail) from error
    if not response.user:
        code, detail = _supabase_error_status(Exception(str(response)))
        raise HTTPException(status_code=code, detail=detail)
    # Nếu project bật "Confirm email": Supabase trả user nhưng KHÔNG có session.
    if not response.session:
        raise HTTPException(
            status_code=status.HTTP_201_CREATED,
            detail="Tạo tài khoản thành công. Vui lòng kiểm tra email để xác nhận trước khi đăng nhập.",
        )
    profile = _ensure_profile(UUID(str(response.user.id)), username, payload.name or "", nickname, grade)
    return _to_token(response.session, profile)


@auth_router.post("/login", response_model=Token)
def login(payload: LoginRequest) -> Token:
    try:
        response = get_supabase_anon().auth.sign_in_with_password(
            {"email": payload.email.strip(), "password": payload.password}
        )
    except HTTPException:
        raise
    except Exception as error:
        code, detail = _supabase_error_status(error)
        # Sai credentials phải là 401 để frontend hiển thị đúng (giữ tương thích test cũ).
        raise HTTPException(status_code=code, detail=detail) from error
    if not response.session or not response.user:
        raise unauthorized("Email hoặc mật khẩu không đúng.")
    profile = _ensure_profile(UUID(str(response.user.id)), None, "")
    return _to_token(response.session, profile)


@auth_router.post("/refresh", response_model=Token)
def refresh(payload: RefreshRequest) -> Token:
    try:
        response = get_supabase_anon().auth.refresh_session(payload.refresh_token)
    except HTTPException:
        raise
    except Exception as error:
        raise unauthorized("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.") from error
    if not response.session or not response.user:
        raise unauthorized("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
    profile = _fetch_profile(UUID(str(response.user.id)))
    return _to_token(response.session, profile)


@auth_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current: SupabaseUser = Depends(get_current_supabase_user)) -> None:
    # Supabase Auth là stateless JWT: client tự xóa session.
    # Backend chỉ xác thực token hợp lệ (qua Depends) rồi trả 204.
    # Nếu muốn revoke refresh token, gọi thêm admin API ở đây.
    return None


@auth_router.post("/reset-password", status_code=status.HTTP_202_ACCEPTED)
def reset_password(payload: ResetPasswordRequest) -> dict:
    """Gửi mail đặt lại mật khẩu qua Supabase Auth. Luôn trả 202 để tránh dò email."""
    try:
        reset_fn = getattr(get_supabase_anon().auth, "reset_password_email", None)
        if reset_fn is None:
            raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Chưa hỗ trợ đặt lại mật khẩu.")
        reset_fn(payload.email.strip())
    except HTTPException:
        raise
    except Exception:
        # Cố tình không báo lỗi chi tiết để kẻ xấu không dò được email nào đã đăng ký.
        pass
    return {"message": "Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi."}


@auth_router.patch("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(payload: PasswordChange, current: SupabaseUser = Depends(get_current_supabase_user)) -> None:
    """Đổi mật khẩu của chính mình (cần access_token còn hiệu lực)."""
    try:
        get_supabase_admin().auth.admin.update_user_by_id(str(current.id), {"password": payload.new_password})
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Không đổi được mật khẩu.") from error


@auth_router.get("/me", response_model=UserPrivate)
def get_me(profile: UserPrivate = Depends(get_current_profile)) -> UserPrivate:
    return profile


# ---------------- Profiles (authorization: chỉ chính mình) ----------------


@router.get("/me", response_model=UserPrivate)
def read_own_profile(profile: UserPrivate = Depends(get_current_profile)) -> UserPrivate:
    return profile


@router.patch("/me", response_model=UserPrivate)
def update_own_profile(
    payload: ProfileUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> UserPrivate:
    values = payload.model_dump(exclude_unset=True)
    if "username" in values and values["username"] is not None:
        values["username"] = _clean_username(values["username"])
    if "nickname" in values and values["nickname"] is not None:
        values["nickname"] = _clean_nickname(values["nickname"])
    if "name" in values and values["name"] is not None:
        values["name"] = values["name"].strip()
    if "grade" in values:
        # None -> xóa lớp (NULL), "" -> xóa, "6".."12" -> đặt.
        try:
            values["grade"] = _clean_grade(values["grade"])
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lớp không hợp lệ. Chọn từ 6 đến 12.",
            ) from error
    if not values:
        row = _fetch_profile(current.id)
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
        return _to_private(row, current.email)
    try:
        try:
            result = (
                get_supabase_admin()
                .table(PROFILES_TABLE)
                .update(values)
                .eq("id", str(current.id))
                .select(PROFILE_COLUMNS)
                .execute()
            )
        except Exception as update_error:
            # DB cũ chưa chạy migration thêm cột grade: Supabase báo
            # "Could not find the 'grade' column...". Xử lý 2 trường hợp:
            # - user có gửi grade -> báo rõ cần chạy migration (không im lặng bỏ qua).
            # - user không gửi grade (chỉ sửa name/username) -> retry không kèm grade.
            message = str(update_error).lower()
            missing_grade_column = "grade" in message and (
                "column" in message or "schema" in message or "42703" in message
            )
            if not missing_grade_column:
                raise
            if "grade" in values:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Chưa có cột grade trong bảng profiles. Hãy chạy migration trong backend/supabase/schema.sql rồi thử lại.",
                ) from update_error
            result = (
                get_supabase_admin()
                .table(PROFILES_TABLE)
                .update(values)
                .eq("id", str(current.id))
                .select(PROFILE_COLUMNS_LEGACY)
                .execute()
            )
        row = _one(result.data)
        return _to_private(row, current.email)
    except HTTPException:
        raise
    except Exception as error:
        _raise_database_error(error)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_own_account(current: SupabaseUser = Depends(get_current_supabase_user)) -> None:
    """Xóa profile + xóa auth user (xóa tài khoản). Cần xác thực lại bằng access_token còn hiệu lực."""
    settings = get_settings()
    _ = settings  # giữ tham chiếu cấu hình cho mở rộng (VD: cấm tự xóa với role admin sau này)
    try:
        get_supabase_admin().table(PROFILES_TABLE).delete().eq("id", str(current.id)).execute()
    except Exception as error:
        _raise_database_error(error)
    try:
        get_supabase_admin().auth.admin.delete_user(str(current.id))
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Không xóa được tài khoản.") from error
