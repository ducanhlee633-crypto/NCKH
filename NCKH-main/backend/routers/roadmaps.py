# Endpoint CRUD cho lộ trình học (RoadmapPage.jsx).
# 3 bảng chuẩn: roadmaps + roadmap_stages + roadmap_lessons.
# - POST /roadmaps: tạo roadmap kèm stages + lessons (validate chéo ngày/giờ,
#   tối đa 120 buổi, stage_index nằm trong số stages hoặc fallback 0..3).
# - GET /roadmaps: liệt kê kèm nested (sắp xếp stages theo position,
#   lessons theo date + start_time).
# - GET/PUT/PATCH/DELETE /roadmaps/{id}: đọc/sửa/xóa của chính mình.
#   PUT/PATCH gửi kèm stages/lessons sẽ thay toàn bộ nested (xóa cũ, chèn mới).
# - PATCH /roadmaps/lessons/{lesson_id}: tick done hoặc sửa 1 buổi học.
from datetime import date as va_date
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from schema import (
    ROADMAP_MAX_LESSONS,
    Roadmap,
    RoadmapCreate,
    RoadmapDetail,
    RoadmapLesson,
    RoadmapLessonCreate,
    RoadmapLessonUpdate,
    RoadmapStage,
    RoadmapStageCreate,
    RoadmapUpdate,
)
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/roadmaps", tags=["roadmaps"])

ROADMAP_TABLE = "roadmaps"
STAGE_TABLE = "roadmap_stages"
LESSON_TABLE = "roadmap_lessons"

ROADMAP_COLUMNS = (
    "id,user_id,goal_id,title,subject,start_date,end_date,start_time,duration_minutes,"
    "sessions_per_week,study_days,context,notes,grade,level,current_score,target_score,"
    "weak_topics,learning_style,ai_generated,created_at,updated_at"
)
STAGE_COLUMNS = "id,roadmap_id,user_id,position,title,goal,materials,checkpoint,created_at,updated_at"
LESSON_COLUMNS = (
    "id,roadmap_id,stage_id,user_id,stage_index,title,focus,date,start_time,end_time,"
    "material_url,material_label,done,created_at,updated_at"
)


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _norm_time(value: object, default: str = "19:00") -> str:
    # Supabase `time` trả về "19:00:00" — chuẩn hóa về "HH:MM" cho frontend.
    text = str(value or default)
    return text[:5] if len(text) >= 5 else text


def _safe_url(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parts = urlparse(text)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            return ""
        if parts.username or parts.password:
            return ""
        return text[:2000]
    except ValueError:
        return ""


def _check_study_days(days: list[int] | None, sessions_per_week: int | None) -> list[int]:
    cleaned = [d for d in (days or []) if isinstance(d, int) and 0 <= d <= 6]
    cleaned = sorted(set(cleaned))
    if sessions_per_week is not None and cleaned and len(cleaned) < sessions_per_week:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chọn đủ ngày rảnh cho số buổi mỗi tuần (1–7 buổi).",
        )
    return cleaned


def _check_dates(start_day: va_date | None, end_day: va_date | None) -> None:
    if start_day and end_day and start_day > end_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày kết thúc không được trước ngày bắt đầu.",
        )


def _check_lesson_times(start: str, end: str) -> None:
    if str(start) >= str(end):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Giờ kết thúc buổi học phải sau giờ bắt đầu.",
        )


def _to_stage(row: dict) -> RoadmapStage:
    data = dict(row)
    materials = data.get("materials")
    if not isinstance(materials, list):
        data["materials"] = []
    else:
        cleaned = []
        for item in materials[:3]:
            if not isinstance(item, dict):
                continue
            url = _safe_url(item.get("url"))
            if not url:
                continue
            label = str(item.get("label") or url).strip()[:200] or url
            cleaned.append({"label": label, "url": url})
        data["materials"] = cleaned
    if data.get("goal") is None:
        data["goal"] = ""
    if data.get("checkpoint") is None:
        data["checkpoint"] = ""
    return RoadmapStage.model_validate(data)


def _to_lesson(row: dict) -> RoadmapLesson:
    data = dict(row)
    for key in ("start_time", "end_time"):
        if data.get(key) is not None:
            data[key] = _norm_time(data[key])
    for key in ("focus", "material_url", "material_label"):
        if data.get(key) is None:
            data[key] = ""
    if data.get("done") is None:
        data["done"] = False
    else:
        data["done"] = bool(data["done"])
    return RoadmapLesson.model_validate(data)


def _to_roadmap(row: dict, stages: list[dict] | None = None, lessons: list[dict] | None = None) -> RoadmapDetail:
    data = dict(row)
    for key in ("start_time",):
        if data.get(key) is not None:
            data[key] = _norm_time(data[key], "19:00")
    if data.get("study_days") is None:
        data["study_days"] = []
    for key in ("notes", "weak_topics", "learning_style", "level", "context"):
        if data.get(key) is None:
            data[key] = "" if key != "level" else ""
    stage_rows = sorted(stages or [], key=lambda r: (int(r.get("position") or 0), str(r.get("id"))))
    lesson_rows = sorted(
        lessons or [],
        key=lambda r: (str(r.get("date")), _norm_time(r.get("start_time"), "00:00"), str(r.get("id"))),
    )
    detail = Roadmap.model_validate(data)
    return RoadmapDetail(
        **detail.model_dump(),
        stages=[_to_stage(r) for r in stage_rows],
        lessons=[_to_lesson(r) for r in lesson_rows],
    )


async def _fetch_roadmap_row(roadmap_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(ROADMAP_TABLE)
                .select(ROADMAP_COLUMNS)
                .eq("id", str(roadmap_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Roadmap not found")
    return result.data[0]


async def _fetch_nested(roadmap_id: UUID, user_id: UUID) -> tuple[list[dict], list[dict]]:
    """Lấy stages + lessons song song (2 query độc lập)."""
    import asyncio

    async def _stages():
        return await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(STAGE_TABLE)
                .select(STAGE_COLUMNS)
                .eq("roadmap_id", str(roadmap_id))
                .eq("user_id", str(user_id))
                .execute()
            )
        )

    async def _lessons():
        return await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(LESSON_TABLE)
                .select(LESSON_COLUMNS)
                .eq("roadmap_id", str(roadmap_id))
                .eq("user_id", str(user_id))
                .execute()
            )
        )

    try:
        stages, lessons = await asyncio.gather(_stages(), _lessons())
    except Exception as error:
        _db_error(error)
    return list(stages.data or []), list(lessons.data or [])


async def _fetch_detail(roadmap_id: UUID, user_id: UUID) -> RoadmapDetail:
    row = await _fetch_roadmap_row(roadmap_id, user_id)
    stages, lessons = await _fetch_nested(roadmap_id, user_id)
    return _to_roadmap(row, stages, lessons)


def _validate_create(payload: RoadmapCreate) -> None:
    _check_dates(payload.start_date, payload.end_date)
    _check_study_days(list(payload.study_days or []), payload.sessions_per_week)
    if str(payload.start_time) >= "24:00":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chọn giờ học hợp lệ.",
        )
    if len(payload.lessons) > ROADMAP_MAX_LESSONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Lộ trình vượt {ROADMAP_MAX_LESSONS} buổi. Hãy rút ngắn thời hạn.",
        )
    stage_count = len(payload.stages)
    for lesson in payload.lessons:
        _check_lesson_times(str(lesson.start_time)[:5], str(lesson.end_time)[:5])
        # Lộ trình AI: stage_index phải nằm trong số stages; cơ bản: 0..3 fallback.
        limit = stage_count if stage_count else 4
        if lesson.stage_index >= limit:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Buổi học vượt quá số chặng của lộ trình.",
            )
        if lesson.material_url and not _safe_url(lesson.material_url):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Link tài liệu buổi học không hợp lệ (chỉ nhận http/https).",
            )
    for stage in payload.stages:
        for item in stage.materials:
            if not _safe_url(item.url):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Link tài liệu chặng không hợp lệ (chỉ nhận http/https).",
                )


async def _insert_nested(
    roadmap_id: str, user_id: str, stages: list[RoadmapStageCreate], lessons: list[RoadmapLessonCreate]
) -> tuple[list[dict], list[dict]]:
    stage_rows: list[dict] = []
    try:
        for position, stage in enumerate(stages):
            values = stage.model_dump(mode="json")
            values["roadmap_id"] = roadmap_id
            values["user_id"] = user_id
            values["position"] = position
            values["materials"] = [
                {"label": str(m.get("label") or m.get("url"))[:200], "url": _safe_url(m.get("url"))}
                for m in (values.get("materials") or [])
                if _safe_url((m or {}).get("url"))
            ][:3]
            created = await run_blocking(
                lambda v=values: (
                    get_supabase_admin().table(STAGE_TABLE).insert(v).select(STAGE_COLUMNS).execute()
                )
            )
            if created.data:
                stage_rows.extend(created.data)
        lesson_rows: list[dict] = []
        for lesson in lessons:
            values = lesson.model_dump(mode="json")
            values["roadmap_id"] = roadmap_id
            values["user_id"] = user_id
            values["stage_id"] = None
            # Map stage_index -> stage_id vừa tạo (AI); cơ bản giữ None + stage_index.
            if stage_rows and 0 <= lesson.stage_index < len(stage_rows):
                values["stage_id"] = stage_rows[lesson.stage_index]["id"]
            values["material_url"] = _safe_url(values.get("material_url"))
            if values["material_url"] and not values.get("material_label"):
                values["material_label"] = values["material_url"][:200]
            created = await run_blocking(
                lambda v=values: (
                    get_supabase_admin().table(LESSON_TABLE).insert(v).select(LESSON_COLUMNS).execute()
                )
            )
            if created.data:
                lesson_rows.extend(created.data)
    except Exception as error:
        _db_error(error)
    return stage_rows, lesson_rows


async def _replace_nested(
    roadmap_id: UUID, user_id: UUID, stages: list[RoadmapStageCreate] | None, lessons: list[RoadmapLessonCreate] | None
) -> None:
    # Thay toàn bộ nested khi PUT/PATCH gửi kèm: xóa cũ rồi chèn mới
    # (lessons trước để tránh vướng FK stage_id, stages sau đó).
    try:
        if lessons is not None:
            await run_blocking(
                lambda: (
                    get_supabase_admin().table(LESSON_TABLE).delete().eq("roadmap_id", str(roadmap_id)).eq(
                        "user_id", str(user_id)
                    ).execute()
                )
            )
        if stages is not None:
            await run_blocking(
                lambda: (
                    get_supabase_admin().table(STAGE_TABLE).delete().eq("roadmap_id", str(roadmap_id)).eq(
                        "user_id", str(user_id)
                    ).execute()
                )
            )
    except Exception as error:
        _db_error(error)
    next_stages = stages if stages is not None else []
    next_lessons = lessons if lessons is not None else []
    if next_stages or next_lessons:
        for lesson in next_lessons:
            _check_lesson_times(str(lesson.start_time)[:5], str(lesson.end_time)[:5])
        await _insert_nested(str(roadmap_id), str(user_id), next_stages, next_lessons)


@router.get("", response_model=list[RoadmapDetail])
async def list_roadmaps(current: SupabaseUser = Depends(get_current_supabase_user)) -> list[RoadmapDetail]:
    """Liệt kê lộ trình của chính mình kèm stages + lessons (mới nhất trước)."""
    import asyncio

    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(ROADMAP_TABLE)
                .select(ROADMAP_COLUMNS)
                .eq("user_id", str(current.id))
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    rows = list(result.data or [])
    rows.sort(key=lambda r: (str(r.get("created_at") or ""), str(r.get("id"))), reverse=True)
    # N roadmap -> N cặp query nested chạy song song thay vì nối tiếp.
    nested = await asyncio.gather(
        *[_fetch_nested(UUID(str(row["id"])), current.id) for row in rows]
    )
    return [_to_roadmap(row, stages, lessons) for row, (stages, lessons) in zip(rows, nested)]


@router.post("", response_model=RoadmapDetail, status_code=status.HTTP_201_CREATED)
async def create_roadmap(payload: RoadmapCreate, current: SupabaseUser = Depends(get_current_supabase_user)) -> RoadmapDetail:
    """Tạo lộ trình mới kèm stages + lessons."""
    _validate_create(payload)
    title = payload.title.strip()
    subject = payload.subject.strip()
    context = payload.context.strip()
    if not title or not subject or not context:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Điền tên lộ trình, môn học và nội dung cần học.",
        )
    # goal_id phải thuộc về chính mình (tránh gán goal của user khác).
    if payload.goal_id is not None:
        try:
            goal = await run_blocking(
                lambda: (
                    get_supabase_admin()
                    .table("goals")
                    .select("id")
                    .eq("id", str(payload.goal_id))
                    .eq("user_id", str(current.id))
                    .limit(1)
                    .execute()
                )
            )
        except Exception as error:
            _db_error(error)
        if not goal.data:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Mục tiêu không còn tồn tại. Hãy chọn lại.",
            )
    values = payload.model_dump(mode="json", exclude={"stages", "lessons"})
    values["title"] = title
    values["subject"] = subject
    values["context"] = context
    values["notes"] = str(values.get("notes") or "").strip()
    values["weak_topics"] = str(values.get("weak_topics") or "").strip()
    values["learning_style"] = str(values.get("learning_style") or "").strip()
    values["study_days"] = _check_study_days(list(values.get("study_days") or []), values.get("sessions_per_week"))
    if values.get("grade") == "":
        values["grade"] = None
    if values.get("level") == "":
        values["level"] = ""
    values["user_id"] = str(current.id)
    values["goal_id"] = str(payload.goal_id) if payload.goal_id else None
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin().table(ROADMAP_TABLE).insert(values).select(ROADMAP_COLUMNS).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    row = result.data[0]
    stages, lessons = await _insert_nested(str(row["id"]), str(current.id), list(payload.stages or []), list(payload.lessons or []))
    return _to_roadmap(row, stages, lessons)


@router.get("/{roadmap_id}", response_model=RoadmapDetail)
async def read_roadmap(roadmap_id: UUID, current: SupabaseUser = Depends(get_current_supabase_user)) -> RoadmapDetail:
    """Đọc 1 lộ trình của chính mình."""
    return await _fetch_detail(roadmap_id, current.id)


async def _apply_update(roadmap_id: UUID, payload: RoadmapUpdate, user_id: UUID) -> RoadmapDetail:
    row = await _fetch_roadmap_row(roadmap_id, user_id)
    current = Roadmap.model_validate({**row, "start_time": _norm_time(row.get("start_time"), "19:00")})
    values = payload.model_dump(exclude_unset=True, mode="json", exclude={"stages", "lessons"})
    # goal_id: None = gỡ liên kết; không gửi = giữ nguyên. Chuỗi rỗng cũng coi như gỡ.
    if "goal_id" in values and (values["goal_id"] is None or values["goal_id"] == ""):
        values["goal_id"] = None
    if values.get("goal_id"):
        try:
            goal = await run_blocking(
                lambda: (
                    get_supabase_admin()
                    .table("goals")
                    .select("id")
                    .eq("id", str(values["goal_id"]))
                    .eq("user_id", str(user_id))
                    .limit(1)
                    .execute()
                )
            )
        except Exception as error:
            _db_error(error)
        if not goal.data:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Mục tiêu không còn tồn tại. Hãy chọn lại.",
            )
    if "title" in values and values["title"] is not None:
        values["title"] = str(values["title"]).strip()
        if not values["title"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hãy nhập tên lộ trình.")
    if "subject" in values and values["subject"] is not None:
        values["subject"] = str(values["subject"]).strip()
        if not values["subject"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hãy nhập môn học.")
    if "context" in values and values["context"] is not None:
        values["context"] = str(values["context"]).strip()
        if not values["context"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hãy nhập nội dung cần học.")
    for key in ("notes", "weak_topics", "learning_style"):
        if key in values and values[key] is not None:
            values[key] = str(values[key]).strip()
    if "grade" in values and values["grade"] == "":
        values["grade"] = None
    next_start = values.get("start_date", str(current.start_date))
    next_end = values.get("end_date", str(current.end_date))
    try:
        _check_dates(va_date.fromisoformat(str(next_start)), va_date.fromisoformat(str(next_end)))
    except ValueError:
        pass
    if "study_days" in values or "sessions_per_week" in values:
        merged_days = list(values.get("study_days", current.study_days or []))
        merged_per = int(values.get("sessions_per_week", current.sessions_per_week or 5))
        values["study_days"] = _check_study_days(merged_days, merged_per)
    if "start_time" in values and values["start_time"] is not None:
        values["start_time"] = _norm_time(values["start_time"]) + (":00" if len(str(values["start_time"])) == 5 else "")
        _check_lesson_times("00:00", "23:59")  # giữ pattern time hợp lệ
    nested_stages = payload.stages if "stages" in payload.model_fields_set else None
    nested_lessons = payload.lessons if "lessons" in payload.model_fields_set else None
    if nested_lessons is not None and len(nested_lessons) > ROADMAP_MAX_LESSONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Lộ trình vượt {ROADMAP_MAX_LESSONS} buổi. Hãy rút ngắn thời hạn.",
        )
    if values:
        try:
            result = await run_blocking(
                lambda: (
                    get_supabase_admin()
                    .table(ROADMAP_TABLE)
                    .update(values)
                    .eq("id", str(roadmap_id))
                    .eq("user_id", str(user_id))
                    .select(ROADMAP_COLUMNS)
                    .execute()
                )
            )
        except Exception as error:
            _db_error(error)
        if not result.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Roadmap not found")
        row = result.data[0]
    if nested_stages is not None or nested_lessons is not None:
        await _replace_nested(roadmap_id, user_id, nested_stages, nested_lessons)
    return await _fetch_detail(roadmap_id, user_id)


@router.put("/{roadmap_id}", response_model=RoadmapDetail)
async def update_roadmap(roadmap_id: UUID, payload: RoadmapUpdate, current: SupabaseUser = Depends(get_current_supabase_user)) -> RoadmapDetail:
    """Sửa lộ trình (chỉ field được gửi mới đổi; gửi kèm stages/lessons để thay nested)."""
    return await _apply_update(roadmap_id, payload, current.id)


@router.patch("/{roadmap_id}", response_model=RoadmapDetail)
async def patch_roadmap(roadmap_id: UUID, payload: RoadmapUpdate, current: SupabaseUser = Depends(get_current_supabase_user)) -> RoadmapDetail:
    """Alias của PUT cho client thích PATCH từng field."""
    return await _apply_update(roadmap_id, payload, current.id)


@router.delete("/{roadmap_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_roadmap(roadmap_id: UUID, current: SupabaseUser = Depends(get_current_supabase_user)) -> Response:
    """Xóa lộ trình + toàn bộ stages/lessons (CASCADE)."""
    await _fetch_roadmap_row(roadmap_id, current.id)
    try:
        await run_blocking(
            lambda: (
                get_supabase_admin().table(ROADMAP_TABLE).delete().eq("id", str(roadmap_id)).eq(
                    "user_id", str(current.id)
                ).execute()
            )
        )
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _fetch_lesson(lesson_id: UUID, user_id: UUID) -> dict:
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(LESSON_TABLE)
                .select(LESSON_COLUMNS)
                .eq("id", str(lesson_id))
                .eq("user_id", str(user_id))
                .limit(1)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Roadmap lesson not found")
    return result.data[0]


@router.patch("/lessons/{lesson_id}", response_model=RoadmapLesson)
async def patch_lesson(
    lesson_id: UUID, payload: RoadmapLessonUpdate, current: SupabaseUser = Depends(get_current_supabase_user)
) -> RoadmapLesson:
    """Tick done / sửa 1 buổi học (chỉ field được gửi mới đổi)."""
    row = await _fetch_lesson(lesson_id, current.id)
    current_lesson = _to_lesson(row)
    values = payload.model_dump(exclude_unset=True, mode="json")
    if "title" in values and values["title"] is not None:
        values["title"] = str(values["title"]).strip()
        if not values["title"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Hãy nhập tên buổi học.")
    for key in ("focus", "material_label"):
        if key in values and values[key] is not None:
            values[key] = str(values[key]).strip()
    if "material_url" in values:
        values["material_url"] = _safe_url(values.get("material_url")) if values.get("material_url") else ""
        if payload.material_url and not values["material_url"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Link tài liệu không hợp lệ (chỉ nhận http/https).",
            )
    if not values:
        return current_lesson
    merged_start = _norm_time(values.get("start_time", str(current_lesson.start_time)))
    merged_end = _norm_time(values.get("end_time", str(current_lesson.end_time)))
    _check_lesson_times(merged_start, merged_end)
    if "start_time" in values:
        values["start_time"] = merged_start + (":00" if len(merged_start) == 5 else "")
    if "end_time" in values:
        values["end_time"] = merged_end + (":00" if len(merged_end) == 5 else "")
    try:
        result = await run_blocking(
            lambda: (
                get_supabase_admin()
                .table(LESSON_TABLE)
                .update(values)
                .eq("id", str(lesson_id))
                .eq("user_id", str(current.id))
                .select(LESSON_COLUMNS)
                .execute()
            )
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Roadmap lesson not found")
    return _to_lesson(result.data[0])
