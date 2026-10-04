from datetime import date as va_date
from datetime import datetime
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SignupRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    # Tên thật / username / nickname lưu vào public.profiles (không dùng để đăng nhập).
    name: str = Field(default="", max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    nickname: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


class ResetPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class PasswordChange(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    nickname: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")


class UserPublic(BaseModel):
    """Hồ sơ công khai — chỉ để hiển thị (VD: bạn bè, BXH). KHÔNG chứa name/username/email."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    nickname: str | None = None


class UserPrivate(BaseModel):
    """Hồ sơ riêng tư — chỉ chính mình được đọc qua GET/PATCH /users/me."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str | None = None
    username: str | None = None
    name: str = ""
    nickname: str | None = None
    created_at: datetime
    updated_at: datetime


class SessionUser(BaseModel):
    id: UUID
    email: str | None = None


class UserPreferences(BaseModel):
    """Lựa chọn hiển thị/học tập trong SettingsPage — KHÔNG chứa name/username/nickname/email/grade/password."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    # FK 1-1 tới auth.users.id. DB cũ chỉ có cột `id` (vừa PK vừa FK),
    # DB mới có thêm cột `user_id` — nhận cả hai khi validate, trả ra `user_id`.
    user_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("user_id", "id"),
        serialization_alias="user_id",
    )
    avatar: str | None = Field(default=None, max_length=3_000_000)
    theme: str = Field(default="light", pattern=r"^(light|dark)$")
    color: str = Field(default="blue", pattern=r"^(blue|violet|gold|mint)$")
    ranking: bool = True
    streak: bool = True
    reminders: bool = True
    reminder_minutes: int = Field(default=15, ge=0, le=60, alias="reminderMinutes")
    weekly_hours: int = Field(default=24, ge=1, le=70, alias="weeklyHours")
    sound: bool = True


class UserPreferencesUpdate(BaseModel):
    """PUT /preferences/me — tất cả optional, chỉ cập nhật field được gửi (upsert)."""

    model_config = ConfigDict(populate_by_name=True)

    avatar: str | None = Field(default=None, max_length=3_000_000)
    theme: str | None = Field(default=None, pattern=r"^(light|dark)$")
    color: str | None = Field(default=None, pattern=r"^(blue|violet|gold|mint)$")
    ranking: bool | None = None
    streak: bool | None = None
    reminders: bool | None = None
    reminder_minutes: int | None = Field(default=None, ge=0, le=60, alias="reminderMinutes")
    weekly_hours: int | None = Field(default=None, ge=1, le=70, alias="weeklyHours")
    sound: bool | None = None


class Token(BaseModel):
    """Session do Supabase Auth cấp — backend chỉ relay lại, không tự ký."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int | None = None
    user: SessionUser
    profile: UserPrivate | None = None


# ---------------- Schedule blocks (SchedulePage.jsx) ----------------
# Lưu 1 dòng cho mỗi chuỗi lặp lại (kiểu Google Calendar): rule repeat nằm
# gọn trong repeat / repeat_days / repeat_until, frontend expand ra các ngày
# khi hiển thị. Xóa/sửa 1 buổi lẻ trong chuỗi dùng exdates + scope=single.

REPEAT_VALUES = ("none", "daily", "weekly", "weekdays", "weekends", "custom", "monthly")

TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$"


class ScheduleBlockBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    subject: str | None = Field(default=None, max_length=80)
    date: va_date
    start_time: str = Field(pattern=TIME_PATTERN)
    end_time: str = Field(pattern=TIME_PATTERN)
    tone: str = Field(default="blue", max_length=20)
    kind: str = Field(default="study", pattern=r"^(study|deadline)$")
    repeat: str = Field(default="none", pattern=r"^(none|daily|weekly|weekdays|weekends|custom|monthly)$")
    repeat_days: list[int] = Field(default_factory=list)
    repeat_until: va_date | None = None


class ScheduleBlockCreate(ScheduleBlockBase):
    pass


class ScheduleBlockUpdate(BaseModel):
    """PUT /schedule/{id} — tất cả optional, chỉ cập nhật field được gửi."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    subject: str | None = Field(default=None, max_length=80)
    date: va_date | None = None
    start_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    end_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    tone: str | None = Field(default=None, max_length=20)
    kind: str | None = Field(default=None, pattern=r"^(study|deadline)$")
    repeat: str | None = Field(default=None, pattern=r"^(none|daily|weekly|weekdays|weekends|custom|monthly)$")
    repeat_days: list[int] | None = None
    repeat_until: va_date | None = None


class ScheduleBlock(BaseModel):
    """Một block học (hoặc một chuỗi lặp lại) của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    subject: str | None = None
    date: va_date
    start_time: str
    end_time: str
    tone: str = "blue"
    kind: str = "study"
    repeat: str = "none"
    repeat_days: list[int] = Field(default_factory=list)
    repeat_until: va_date | None = None
    exdates: list[va_date] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


# ---------------- Deadlines (SchedulePage.jsx) ----------------
# CRUD đơn giản cho hạn nộp bài: tên + ngày nộp + giờ nộp + mức độ + trạng thái.
# Không lặp lại, không tách chuỗi như schedule_blocks. Mỗi deadline 1 dòng.

PRIORITY_VALUES = ("high", "medium", "low")


class DeadlineBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    due_date: va_date
    due_time: str = Field(default="23:59", pattern=TIME_PATTERN)
    priority: str = Field(default="medium", pattern=r"^(high|medium|low)$")
    status: bool = False


class DeadlineCreate(DeadlineBase):
    pass


class DeadlineUpdate(BaseModel):
    """PUT/PATCH /deadlines/{id} — tất cả optional, chỉ cập nhật field được gửi."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    due_date: va_date | None = None
    due_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    priority: str | None = Field(default=None, pattern=r"^(high|medium|low)$")
    status: bool | None = None


class Deadline(BaseModel):
    """Một hạn nộp bài của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    due_date: va_date
    due_time: str
    priority: str = "medium"
    status: bool = False
    created_at: datetime
    updated_at: datetime


# ---------------- Friendships (FriendsPage) ----------------
# Kết bạn 2 bước: A gửi request (pending) -> B accept (accepted) / reject (xóa).
# Lưu friend bằng friend_id (UUID FK tới profiles.id) để không gãy khi đổi username.
# Khi thao tác từ frontend, dùng `username` (friend_username) để tìm/resolve,
# backend tự map sang friend_id.

FRIENDSHIP_STATUS_VALUES = ("pending", "accepted")


class FriendshipRequestCreate(BaseModel):
    """POST /friends/requests — gửi lời mời bằng username của bạn."""

    model_config = ConfigDict(populate_by_name=True)

    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")


class Friendship(BaseModel):
    """Một quan hệ bạn bè (1 dòng: user_id -> friend_id + status)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    friend_id: UUID
    status: str = Field(pattern=r"^(pending|accepted)$")
    created_at: datetime
    updated_at: datetime


class FriendProfile(BaseModel):
    """Profile rút gọn để tìm kiếm / hiển thị bạn bè (username + nickname)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str | None = None
    nickname: str | None = None


class FriendshipDetail(BaseModel):
    """Friendship kèm profile của 'người còn lại' (để frontend hiển thị ngay)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    friend_id: UUID
    status: str = Field(pattern=r"^(pending|accepted)$")
    created_at: datetime
    updated_at: datetime
    friend: FriendProfile | None = None


# ---------------- Feedback (HelpPage) ----------------
# Góp ý nhỏ trong trang Trợ giúp: user gửi 1 dòng message (1..2000 ký tự).
# Mỗi góp ý 1 dòng, không sửa — chỉ gửi, xem lại, xóa của chính mình.


class FeedbackCreate(BaseModel):
    """POST /feedback — gửi góp ý mới."""

    model_config = ConfigDict(populate_by_name=True)

    message: str = Field(min_length=1, max_length=2000)


class Feedback(BaseModel):
    """Một góp ý của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    message: str
    created_at: datetime
    updated_at: datetime


# ---------------- Pomodoro / Focus sessions (PomodoroPage.jsx) ----------------
# Gọn nhẹ theo yêu cầu: mỗi phiên focus đã hoàn thành là 1 dòng —
# số phút focus + thời gian cụ thể (started_at/ended_at) + môn học.
# Môn học khóa cứng 9 lựa chọn: Toán, Lí, Hoá, Văn, Sinh, Sử, Địa, Tin, Dự án
# (None = không chọn môn). Không lưu phiên đang chạy / nghỉ / hủy giữa chừng.
# Không sửa — chỉ ghi, xem lại, xem thống kê, xóa của chính mình.

POMODORO_SUBJECT_VALUES = ("Toán", "Lí", "Hoá", "Văn", "Sinh", "Sử", "Địa", "Tin", "Dự án")

POMODORO_SUBJECT_PATTERN = r"^(Toán|Lí|Hoá|Văn|Sinh|Sử|Địa|Tin|Dự án)$"


class PomodoroSessionCreate(BaseModel):
    """POST /pomodoro — ghi 1 phiên focus đã hoàn thành."""

    model_config = ConfigDict(populate_by_name=True)

    focus_minutes: int = Field(ge=1, le=180)
    subject: str | None = Field(default=None, pattern=POMODORO_SUBJECT_PATTERN)
    started_at: datetime
    ended_at: datetime


class PomodoroSession(BaseModel):
    """Một phiên focus đã hoàn thành của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    focus_minutes: int
    subject: str | None = None
    started_at: datetime
    ended_at: datetime
    created_at: datetime
    updated_at: datetime


class PomodoroDaySummary(BaseModel):
    """Tổng hợp 1 ngày: YYYY-MM-DD + số phút + số phiên."""

    date: va_date
    total_minutes: int
    total_sessions: int


class PomodoroSummary(BaseModel):
    """GET /pomodoro/summary — tổng phút/phiên trong khoảng ngày."""

    total_minutes: int
    total_sessions: int
    days: list[PomodoroDaySummary] = Field(default_factory=list)
