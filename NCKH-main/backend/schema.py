from datetime import date as va_date
from datetime import datetime
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


# Lớp đang học (6..12) lưu ở public.profiles.grade — đồng bộ ở SettingsPage.
# Dùng text để khớp Supabase + frontend (select value là string "6".."12").
GRADE_VALUES = ("6", "7", "8", "9", "10", "11", "12")
GRADE_PATTERN = r"^(6|7|8|9|10|11|12)$"


class SignupRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    # Tên thật / username / nickname / lớp lưu vào public.profiles (không dùng để đăng nhập).
    name: str = Field(default="", max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    nickname: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    grade: str | None = Field(default=None, pattern=GRADE_PATTERN)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


class ResetPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class VerifyCallbackRequest(BaseModel):
    """Đổi `code` trong link xác nhận email (luồng PKCE) lấy session."""

    code: str = Field(min_length=10, max_length=4096)


class PasswordChange(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class ProfileUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    nickname: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    # Lớp đang học — gửi null/""/bỏ trống để xóa, gửi "6".."12" để đặt.
    grade: str | None = Field(default=None, pattern=GRADE_PATTERN)


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
    grade: str | None = Field(default=None, pattern=GRADE_PATTERN)
    created_at: datetime
    updated_at: datetime


class SessionUser(BaseModel):
    id: UUID
    email: str | None = None


# Chất giọng AI trong SettingsPage — key DB `ai_tone`, alias camelCase `aiTone` cho frontend.
AI_TONE_VALUES = ("cute", "honest", "funny", "empathetic")
AI_TONE_PATTERN = r"^(cute|honest|funny|empathetic)$"


class UserPreferences(BaseModel):
    """Lựa chọn hiển thị/học tập/AI trong SettingsPage — KHÔNG chứa name/username/nickname/email/grade/password."""

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
    ai_tone: str = Field(default="cute", pattern=AI_TONE_PATTERN, alias="aiTone")


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
    ai_tone: str | None = Field(default=None, pattern=AI_TONE_PATTERN, alias="aiTone")


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


# ---------------- Goals (GoalsPage.jsx) ----------------
# Mục tiêu cá nhân: tên + điểm mong muốn (nullable) + biểu tượng
# + ngày bắt đầu/kết thúc + trạng thái + tiến độ 0..100.

GOAL_STATUS_VALUES = ("in_progress", "completed")


class GoalBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    target_score: float | None = Field(default=None, ge=0, le=10)
    icon: str = Field(default="🌱", min_length=1, max_length=16)
    start_date: va_date
    end_date: va_date
    status: str = Field(default="in_progress", pattern=r"^(in_progress|completed)$")
    progress: int = Field(default=0, ge=0, le=100)


class GoalCreate(GoalBase):
    pass


class GoalUpdate(BaseModel):
    """PUT/PATCH /goals/{id} — tất cả optional, chỉ cập nhật field được gửi."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    target_score: float | None = Field(default=None, ge=0, le=10)
    icon: str | None = Field(default=None, min_length=1, max_length=16)
    start_date: va_date | None = None
    end_date: va_date | None = None
    status: str | None = Field(default=None, pattern=r"^(in_progress|completed)$")
    progress: int | None = Field(default=None, ge=0, le=100)


class Goal(BaseModel):
    """Một mục tiêu của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    target_score: float | None = None
    icon: str = "🌱"
    start_date: va_date
    end_date: va_date
    status: str = "in_progress"
    progress: int = 0
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
# Danh mục môn là single source ở subjects.py (POMODORO_SUBJECT_VALUES khớp
# CHECK pomodoro_sessions_subject_check trong supabase/schema.sql).
# None = không chọn môn. Không lưu phiên đang chạy / nghỉ / hủy giữa chừng.
# Không sửa — chỉ ghi, xem lại, xem thống kê, xóa của chính mình.
# Import lại ở đây để code cũ dùng `from schema import ...` không bị vỡ.
from subjects import POMODORO_SUBJECT_PATTERN as POMODORO_SUBJECT_PATTERN
from subjects import POMODORO_SUBJECT_VALUES as POMODORO_SUBJECT_VALUES
from subjects import SCHOOL_SUBJECTS as SCHOOL_SUBJECTS


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


# ---------------- AI sessions / messages (lưu lịch sử chat, tiền đề RAG) ----------------
# Router thuần lưu trữ, KHÔNG gọi model AI (logic chat nằm ở routers/ai.py).
# - ai_sessions: 1 dòng cho mỗi lần bấm "Tạo đoạn chat mới" (title do frontend gửi).
# - ai_messages: 1 dòng cho mỗi lượt user/assistant, sắp xếp theo created_at ASC
#   khi đọc lại để dựng context cho RAG sau này.

AI_SESSION_TITLE_MAX_LENGTH = 200
AI_MESSAGE_CONTENT_MAX_LENGTH = 12000
AI_MESSAGE_ROLE_VALUES = ("user", "assistant")


class AiSessionCreate(BaseModel):
    """POST /ai/sessions — tạo phiên chat mới (title do frontend gửi)."""

    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=AI_SESSION_TITLE_MAX_LENGTH)


class AiSessionUpdate(BaseModel):
    """PUT/PATCH /ai/sessions/{id} — chỉ đổi title."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=AI_SESSION_TITLE_MAX_LENGTH)


class AiSession(BaseModel):
    """Một phiên chat của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime


class AiMessageCreate(BaseModel):
    """POST /ai/sessions/{id}/messages — lưu 1 lượt nhắn (user hoặc assistant)."""

    model_config = ConfigDict(populate_by_name=True)

    role: str = Field(pattern=r"^(user|assistant)$")
    content: str = Field(min_length=1, max_length=AI_MESSAGE_CONTENT_MAX_LENGTH)


class AiMessageUpdate(BaseModel):
    """PUT/PATCH message — chỉ sửa content (giữ role bất biến để log RAG nhất quán)."""

    model_config = ConfigDict(populate_by_name=True)

    content: str | None = Field(default=None, min_length=1, max_length=AI_MESSAGE_CONTENT_MAX_LENGTH)


class AiMessage(BaseModel):
    """Một tin nhắn trong phiên chat của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_id: UUID
    user_id: UUID
    role: str = Field(pattern=r"^(user|assistant)$")
    content: str
    created_at: datetime
    updated_at: datetime


# ---------------- Roadmaps (RoadmapPage.jsx) ----------------
# Lộ trình học 3 bảng chuẩn: roadmaps + roadmap_stages + roadmap_lessons.
# - roadmaps: scalar từ draft (title, subject, start/end_date, start_time +
#   duration_minutes, sessions_per_week, study_days, context, notes, grade,
#   level, scores, weak_topics, learning_style, goal_id, ai_generated).
# - roadmap_stages: chặng AI (title, goal, materials JSONB [{label,url}] max 3,
#   checkpoint, position). Lộ trình cơ bản không có stage rows.
# - roadmap_lessons: buổi học (title, focus, date, start/end_time,
#   material_url/label, done, stage_index để xếp chặng, stage_id nullable).
# user_id denormalize trên cả 3 bảng để RLS đơn giản.

ROADMAP_LEVEL_VALUES = ("", "foundation", "basic", "confident", "advanced")
ROADMAP_MAX_LESSONS = 120


class RoadmapStageMaterial(BaseModel):
    """Tài liệu trong 1 chặng: label hiển thị + url http(s)."""

    model_config = ConfigDict(populate_by_name=True)

    label: str = Field(min_length=1, max_length=200)
    url: str = Field(min_length=1, max_length=2000)


class RoadmapStageBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    goal: str = Field(default="", max_length=800)
    materials: list[RoadmapStageMaterial] = Field(default_factory=list, max_length=3)
    checkpoint: str = Field(default="", max_length=800)


class RoadmapStageCreate(RoadmapStageBase):
    pass


class RoadmapStageUpdate(BaseModel):
    """PUT/PATCH stage — tất cả optional."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    goal: str | None = Field(default=None, max_length=800)
    materials: list[RoadmapStageMaterial] | None = Field(default=None, max_length=3)
    checkpoint: str | None = Field(default=None, max_length=800)


class RoadmapStage(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    roadmap_id: UUID
    user_id: UUID
    position: int = 0
    title: str
    goal: str = ""
    materials: list[RoadmapStageMaterial] = Field(default_factory=list)
    checkpoint: str = ""
    created_at: datetime
    updated_at: datetime


class RoadmapLessonBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    focus: str = Field(default="", max_length=600)
    stage_index: int = Field(default=0, ge=0, le=10)
    date: va_date
    start_time: str = Field(pattern=TIME_PATTERN)
    end_time: str = Field(pattern=TIME_PATTERN)
    material_url: str = Field(default="", max_length=2000)
    material_label: str = Field(default="", max_length=200)


class RoadmapLessonCreate(RoadmapLessonBase):
    pass


class RoadmapLessonUpdate(BaseModel):
    """PATCH /roadmaps/lessons/{id} — tick done hoặc sửa nội dung buổi học."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    focus: str | None = Field(default=None, max_length=600)
    stage_index: int | None = Field(default=None, ge=0, le=10)
    date: va_date | None = None
    start_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    end_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    material_url: str | None = Field(default=None, max_length=2000)
    material_label: str | None = Field(default=None, max_length=200)
    done: bool | None = None


class RoadmapLesson(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    roadmap_id: UUID
    stage_id: UUID | None = None
    user_id: UUID
    stage_index: int = 0
    title: str
    focus: str = ""
    date: va_date
    start_time: str
    end_time: str
    material_url: str = ""
    material_label: str = ""
    done: bool = False
    created_at: datetime
    updated_at: datetime


class RoadmapBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    goal_id: UUID | None = None
    title: str = Field(min_length=1, max_length=160)
    subject: str = Field(min_length=1, max_length=80)
    start_date: va_date
    end_date: va_date
    start_time: str = Field(default="19:00", pattern=TIME_PATTERN)
    duration_minutes: int = Field(default=60, ge=5, le=240)
    sessions_per_week: int = Field(default=5, ge=1, le=7)
    study_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5, 6])
    context: str = Field(min_length=1, max_length=2000)
    notes: str = Field(default="", max_length=2000)
    grade: str | None = Field(default=None, pattern=GRADE_PATTERN)
    level: str = Field(default="", pattern=r"^$|^(foundation|basic|confident|advanced)$")
    current_score: float | None = Field(default=None, ge=0, le=10)
    target_score: float | None = Field(default=None, ge=0, le=10)
    weak_topics: str = Field(default="", max_length=600)
    learning_style: str = Field(default="", max_length=300)
    ai_generated: bool = False


class RoadmapCreate(RoadmapBase):
    """POST /roadmaps — tạo lộ trình kèm stages + lessons (tối đa 120 buổi)."""

    stages: list[RoadmapStageCreate] = Field(default_factory=list, max_length=5)
    lessons: list[RoadmapLessonCreate] = Field(default_factory=list, max_length=ROADMAP_MAX_LESSONS)


class RoadmapUpdate(BaseModel):
    """PUT/PATCH /roadmaps/{id} — scalar optional; gửi stages/lessons để thay toàn bộ nested."""

    model_config = ConfigDict(populate_by_name=True)

    goal_id: UUID | None = None
    title: str | None = Field(default=None, min_length=1, max_length=160)
    subject: str | None = Field(default=None, min_length=1, max_length=80)
    start_date: va_date | None = None
    end_date: va_date | None = None
    start_time: str | None = Field(default=None, pattern=TIME_PATTERN)
    duration_minutes: int | None = Field(default=None, ge=5, le=240)
    sessions_per_week: int | None = Field(default=None, ge=1, le=7)
    study_days: list[int] | None = None
    context: str | None = Field(default=None, min_length=1, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)
    grade: str | None = Field(default=None, pattern=GRADE_PATTERN)
    level: str | None = Field(default=None, pattern=r"^$|^(foundation|basic|confident|advanced)$")
    current_score: float | None = Field(default=None, ge=0, le=10)
    target_score: float | None = Field(default=None, ge=0, le=10)
    weak_topics: str | None = Field(default=None, max_length=600)
    learning_style: str | None = Field(default=None, max_length=300)
    ai_generated: bool | None = None
    stages: list[RoadmapStageCreate] | None = Field(default=None, max_length=5)
    lessons: list[RoadmapLessonCreate] | None = Field(default=None, max_length=ROADMAP_MAX_LESSONS)


class Roadmap(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    goal_id: UUID | None = None
    title: str
    subject: str
    start_date: va_date
    end_date: va_date
    start_time: str
    duration_minutes: int = 60
    sessions_per_week: int = 5
    study_days: list[int] = Field(default_factory=list)
    context: str = ""
    notes: str = ""
    grade: str | None = None
    level: str = ""
    current_score: float | None = None
    target_score: float | None = None
    weak_topics: str = ""
    learning_style: str = ""
    ai_generated: bool = False
    created_at: datetime
    updated_at: datetime


class RoadmapDetail(Roadmap):
    """Lộ trình kèm stages + lessons đã sắp xếp (trả về cho RoadmapPage)."""

    stages: list[RoadmapStage] = Field(default_factory=list)
    lessons: list[RoadmapLesson] = Field(default_factory=list)


# ---------------- Weekly tasks (WeeklyTasksPage.jsx) ----------------
# Kanban việc trong tuần: title + description + subject + date (nullable)
# + priority (high|medium|low) + status (todo|doing|done).
# date NULL = chưa hẹn ngày -> frontend luôn hiện (không lọc theo tuần).

WEEKLY_TASK_STATUS_VALUES = ("todo", "doing", "done")
WEEKLY_TASK_PRIORITY_VALUES = ("high", "medium", "low")


class WeeklyTaskBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    subject: str | None = Field(default=None, max_length=40)
    date: va_date | None = None
    priority: str = Field(default="medium", pattern=r"^(high|medium|low)$")
    status: str = Field(default="todo", pattern=r"^(todo|doing|done)$")


class WeeklyTaskCreate(WeeklyTaskBase):
    pass


class WeeklyTaskUpdate(BaseModel):
    """PUT/PATCH /weekly-tasks/{id} — tất cả optional, chỉ cập nhật field được gửi."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    subject: str | None = Field(default=None, max_length=40)
    date: va_date | None = None
    priority: str | None = Field(default=None, pattern=r"^(high|medium|low)$")
    status: str | None = Field(default=None, pattern=r"^(todo|doing|done)$")


class WeeklyTask(BaseModel):
    """Một việc trong tuần của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    description: str = ""
    subject: str | None = None
    date: va_date | None = None
    priority: str = "medium"
    status: str = "todo"
    created_at: datetime
    updated_at: datetime


# ---------------- Daily tasks (DashboardPage.jsx) ----------------
# Việc cần làm hằng ngày: title + description + subject + task_date (bắt buộc)
# + priority (high|medium|low) + done (bool checkbox) + position (thứ tự tay).
# task_date bắt buộc để Dashboard lọc "hôm nay" / ngày khác.
# done bool (không dùng todo/doing/done như weekly) để tương thích
# local cũ `nhip-hoc-tasks` {id,title,done}.

DAILY_TASK_PRIORITY_VALUES = ("high", "medium", "low")


class DailyTaskBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=500)
    subject: str | None = Field(default=None, max_length=40)
    task_date: va_date
    priority: str = Field(default="medium", pattern=r"^(high|medium|low)$")
    done: bool = False
    position: int = Field(default=0, ge=0, le=10000)


class DailyTaskCreate(DailyTaskBase):
    pass


class DailyTaskUpdate(BaseModel):
    """PUT/PATCH /daily-tasks/{id} — tất cả optional, chỉ cập nhật field được gửi."""

    model_config = ConfigDict(populate_by_name=True)

    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=500)
    subject: str | None = Field(default=None, max_length=40)
    task_date: va_date | None = None
    priority: str | None = Field(default=None, pattern=r"^(high|medium|low)$")
    done: bool | None = None
    position: int | None = Field(default=None, ge=0, le=10000)


class DailyTask(BaseModel):
    """Một việc hằng ngày của chính mình."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    description: str = ""
    subject: str | None = None
    task_date: va_date
    priority: str = "medium"
    done: bool = False
    position: int = 0
    created_at: datetime
    updated_at: datetime
