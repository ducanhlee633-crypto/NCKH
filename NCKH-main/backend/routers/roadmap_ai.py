"""Generate validated learning plans; long plans are expanded one stage at a time."""
import asyncio
import json
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from time import monotonic
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError, model_validator

from agent_tools.roadmap_prompt import MAX_SESSIONS, ROADMAP_SYSTEM_PROMPT, build_roadmap_user_prompt
from agent_tools.web_search import search_documents
from async_utils import run_blocking
from auth import SupabaseUser, get_current_supabase_user
from config import get_settings

router = APIRouter(prefix="/ai", tags=["ai-roadmap"])
DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"


class RoadmapMaterial(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    url: str = Field(max_length=2000)


class RoadmapLesson(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    focus: str = Field(min_length=1, max_length=600)
    material_url: str = Field(default="", max_length=2000)


class RoadmapStage(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    goal: str = Field(min_length=1, max_length=800)
    materials: list[RoadmapMaterial] = Field(default_factory=list, max_length=3)
    checkpoint: str = Field(min_length=1, max_length=800)
    lessons: list[RoadmapLesson] = Field(min_length=1, max_length=MAX_SESSIONS)


class LearnerProfile(BaseModel):
    grade: int | None = Field(default=None, ge=6, le=12)
    level: Literal["", "foundation", "basic", "confident", "advanced"] = ""
    current_score: float | None = Field(default=None, ge=0, le=10, alias="currentScore")
    target_score: float | None = Field(default=None, ge=0, le=10, alias="targetScore")
    weak_topics: str = Field(default="", max_length=600, alias="weakTopics")
    learning_style: str = Field(default="", max_length=300, alias="learningStyle")
    model_config = {"populate_by_name": True}


class GoalDetails(BaseModel):
    target_score: float | None = Field(default=None, ge=0, le=10, alias="targetScore")
    deadline: date | None = None
    progress: float = Field(default=0, ge=0, le=100)
    model_config = {"populate_by_name": True}


class RoadmapRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=80)
    context: str = Field(min_length=1, max_length=2000)
    total_sessions: int = Field(alias="totalSessions", ge=1, le=MAX_SESSIONS)
    goal_title: str = Field(default="", max_length=160, alias="goalTitle")
    duration: int = Field(default=60, ge=5, le=240)
    sessions_per_week: int = Field(default=5, ge=1, le=7, alias="sessionsPerWeek")
    learner_profile: LearnerProfile = Field(default_factory=LearnerProfile, alias="learnerProfile")
    goal_details: GoalDetails | None = Field(default=None, alias="goalDetails")
    start_date: date | None = Field(default=None, alias="startDate")
    end_date: date | None = Field(default=None, alias="endDate")
    study_days: list[int] = Field(default_factory=lambda: list(range(7)), alias="studyDays", min_length=1, max_length=7)
    notes: str = Field(default="", max_length=2000)
    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def validate_schedule(self):
        if not self.subject.strip() or not self.context.strip():
            raise ValueError("Hãy nhập môn học và ngữ cảnh học tập.")
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError("Ngày kết thúc không được trước ngày bắt đầu.")
        if any(day < 0 or day > 6 for day in self.study_days) or len(set(self.study_days)) != len(self.study_days):
            raise ValueError("Ngày học trong tuần không hợp lệ.")
        if self.sessions_per_week > len(self.study_days):
            raise ValueError("Số buổi mỗi tuần vượt số ngày có thể học.")
        return self


class RoadmapResponse(BaseModel):
    stages: list[RoadmapStage]
    model: str
    search_used: bool = Field(alias="searchUsed")
    warnings: list[str] = Field(default_factory=list)
    model_config = {"populate_by_name": True}


def _clean(value, limit):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit].strip()


def _safe_url(url):
    try:
        parts = urlparse(url)
        return parts.scheme in ("http", "https") and bool(parts.hostname) and not parts.username and not parts.password
    except ValueError:
        return False


def _queries_for(subject, context, profile=None):
    profile = profile or LearnerProfile()
    grade = f"lớp {profile.grade}" if profile.grade else ""
    topic = _clean(profile.weak_topics or context, 100)
    base = f"{subject} {grade} {topic}".strip()
    return [f"{base} {kind}" for kind in ("bài giảng lý thuyết", "bài tập có lời giải", "ôn tập kiểm tra")]


def _collect_materials(subject, context, profile=None):
    def search(query):
        try:
            return search_documents(query, max_results=5)
        except Exception:
            return []

    collected, seen = [], set()
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(search, _queries_for(subject, context, profile)))
    # Interleave queries so theory, practice and assessments all have a chance.
    for index in range(5):
        for found in results:
            if not isinstance(found, list) or index >= len(found) or not isinstance(found[index], dict):
                continue
            item = found[index]
            url = str(item.get("url") or "").strip()
            if len(url) > 2000 or not _safe_url(url):
                continue
            parts = urlparse(url)
            key = (parts.netloc.lower(), parts.path, parts.query)
            if key in seen:
                continue
            seen.add(key)
            collected.append({"label": _clean(item.get("title") or url, 120), "url": url,
                              "snippet": _clean(item.get("snippet"), 300)})
            if len(collected) == 10:
                return collected, True
    return collected, bool(collected)


def _parse_json(reply):
    cleaned = re.sub(r"^```(?:json)?\s*(.*?)\s*```$", r"\1", reply.strip(), flags=re.S | re.I)
    try:
        data = json.loads(cleaned)
    except (ValueError, TypeError) as error:
        raise ValueError("JSON không hợp lệ hoặc đã bị cắt ngắn.") from error
    if not isinstance(data, dict):
        raise ValueError("Đầu ra phải là một JSON object.")
    return data


def _normalize_plan(raw_stages, allowed_urls, total):
    if not isinstance(raw_stages, list) or not 1 <= len(raw_stages) <= 5:
        raise ValueError("Cần từ 1 đến 5 chặng.")
    stages, seen = [], set()
    for raw in raw_stages:
        stage = RoadmapStage.model_validate(raw).model_dump()
        for field in ("title", "goal", "checkpoint"):
            stage[field] = stage[field].strip()
            if not stage[field]:
                raise ValueError(f"Chặng thiếu {field}.")
        materials = {m["url"]: m for m in stage["materials"] if m["url"] in allowed_urls and _safe_url(m["url"])}
        for lesson in stage["lessons"]:
            lesson["title"] = lesson["title"].strip()
            lesson["focus"] = lesson["focus"].strip()
            key = (_clean(lesson["title"], 160).casefold(), _clean(lesson["focus"], 600).casefold())
            if not all(key) or key in seen:
                raise ValueError("Buổi học rỗng hoặc lặp nguyên nội dung; hãy soạn việc làm riêng cho từng buổi.")
            seen.add(key)
            url = lesson["material_url"].strip()
            lesson["material_url"] = url if url in allowed_urls and _safe_url(url) else ""
            if lesson["material_url"] and url not in materials:
                materials[url] = {"label": url, "url": url}
        if len(materials) > 3:
            raise ValueError("Mỗi chặng chỉ dùng tối đa 3 tài liệu, gồm cả link của buổi học.")
        stage["materials"] = list(materials.values())
        stages.append(stage)
    count = sum(len(stage["lessons"]) for stage in stages)
    if count != total:
        raise ValueError(f"Cần đúng {total} buổi, nhận được {count}; không thêm buổi trùng hoặc bỏ chặng cuối.")
    return stages


def _request_json(client, model, prompt, tokens, validate, deadline):
    messages = [{"role": "system", "content": ROADMAP_SYSTEM_PROMPT}, {"role": "user", "content": prompt}]
    for attempt in range(2):
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise HTTPException(504, "AI soạn quá lâu. Hãy giảm số buổi hoặc thử lại.")
        try:
            completion = client.chat.completions.create(
                model=model, messages=messages, temperature=0.35, max_tokens=tokens,
                stream=False, timeout=min(60.0, remaining),
                # Như chat: model reasoning ăn chung budget max_tokens.
                # Ép effort=low để dành chỗ cho JSON lộ trình.
                extra_body={"reasoning": {"effort": "low", "exclude": True}},
            )
        except Exception as error:
            code = getattr(error, "status_code", None)
            if code == 429:
                raise HTTPException(429, "AI đang giới hạn lượt dùng. Vui lòng thử lại sau.") from error
            raise HTTPException(502, "Không kết nối được dịch vụ AI. Vui lòng thử lại.") from error
        try:
            choice = completion.choices[0]
            if getattr(choice, "finish_reason", None) == "length":
                raise ValueError("Đầu ra bị cắt ngắn; viết ngắn hơn nhưng giữ đủ số buổi.")
            reply = choice.message.content
            if not isinstance(reply, str) or not reply.strip():
                raise ValueError("AI trả nội dung rỗng.")
            return validate(_parse_json(reply))
        except (ValueError, TypeError, AttributeError, IndexError, ValidationError) as error:
            if attempt:
                raise HTTPException(502, "AI chưa soạn đủ lộ trình hợp lệ sau khi thử sửa. Hãy thử lại; chưa có lộ trình nào được lưu.") from error
            messages.append({"role": "user", "content": f"Hãy tạo lại toàn bộ JSON. Lỗi cần sửa: {str(error)[:800]}"})


@router.post("/roadmap", response_model=RoadmapResponse)
async def generate_roadmap(payload: RoadmapRequest, current: SupabaseUser = Depends(get_current_supabase_user)):
    settings = get_settings()
    if not (settings.openrouter_api_key or "").strip():
        raise HTTPException(503, "Dịch vụ AI chưa được cấu hình.")
    deadline = monotonic() + 180
    # Search 3 query song song trong threadpool (giữ nguyên helper sync để test mock được).
    materials, search_used = await run_blocking(
        _collect_materials, payload.subject, payload.context, payload.learner_profile
    )
    allowed_urls = {m["url"] for m in materials}
    total = payload.total_sessions
    prompt = build_roadmap_user_prompt(
        subject=payload.subject.strip(), context=payload.context.strip(), total_sessions=total,
        goal_title=payload.goal_title, duration=payload.duration, sessions_per_week=payload.sessions_per_week,
        allowed_materials=materials, learnerProfile=payload.learner_profile.model_dump(by_alias=True),
        goalDetails=payload.goal_details.model_dump(mode="json", by_alias=True) if payload.goal_details else None,
        startDate=str(payload.start_date) if payload.start_date else None,
        endDate=str(payload.end_date) if payload.end_date else None, studyDays=payload.study_days, notes=payload.notes,
    )
    try:
        from openai import OpenAI
    except ImportError as error:
        raise HTTPException(503, "Backend thiếu thư viện openai.") from error
    headers = {}
    if settings.openrouter_site_url:
        headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        headers["X-Title"] = settings.openrouter_app_name
    model = (settings.openrouter_model or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=settings.openrouter_api_key,
                    timeout=60.0, max_retries=0, default_headers=headers)
    try:
        if total <= 16:
            stages = await run_blocking(
                _request_json, client, model, prompt, 1800 + total * 350,
                lambda data: _normalize_plan(data.get("stages"), allowed_urls, total), deadline,
            )
        else:
            def validate_outline(data):
                raw = data.get("stages")
                if not isinstance(raw, list) or not 1 <= len(raw) <= 5:
                    raise ValueError("Cần 1-5 chặng.")
                counts = [s.get("session_count") if isinstance(s, dict) else None for s in raw]
                if any(type(n) is not int or not 1 <= n <= 40 for n in counts) or sum(counts) != total:
                    raise ValueError(f"Mỗi chặng 1-40 buổi, tổng session_count phải bằng {total}.")
                # Validate outline metadata through the same schema used for full plans.
                checked = _normalize_plan([{**s, "lessons": [{"title": f"Buổi {i}", "focus": "outline"}]} for i, s in enumerate(raw)], allowed_urls, len(raw))
                return [{**s, "lessons": [], "session_count": n} for s, n in zip(checked, counts)]

            outline = await run_blocking(
                _request_json, client, model, prompt + '\n{"mode":"outline"}', 3500, validate_outline, deadline,
            )

            def expand(index):
                stage = outline[index]
                count = stage["session_count"]
                stage_prompt = prompt + "\n" + json.dumps({"mode": "stage", "outline": outline,
                    "stage_index": index, "stage": stage,
                    "session_offset": sum(s["session_count"] for s in outline[:index])}, ensure_ascii=False)
                return _request_json(client, model, stage_prompt, 1000 + count * 350,
                    lambda data: _normalize_plan([{**stage, "lessons": data.get("lessons")}], allowed_urls, count)[0], deadline)

            # Mỗi chặng expand độc lập (gọi LLM riêng) -> chạy song song qua threadpool,
            # giữ đúng thứ tự chặng như ThreadPoolExecutor.map trước đây.
            async def _expand_one(index: int):
                return await run_blocking(expand, index)

            stages = list(await asyncio.gather(*[_expand_one(i) for i in range(len(outline))]))
            try:
                stages = _normalize_plan(stages, allowed_urls, total)
            except ValueError as error:
                raise HTTPException(502, "Các chặng AI bị trùng nội dung. Hãy thử soạn lại.") from error
    finally:
        client.close()
    # Use search titles, not labels invented by the model.
    labels = {m["url"]: m["label"] for m in materials}
    for stage in stages:
        for material in stage["materials"]:
            material["label"] = labels[material["url"]]
    missing = sum(not lesson["material_url"] for stage in stages for lesson in stage["lessons"])
    warnings = [f"{missing} buổi chưa có tài liệu phù hợp từ tìm kiếm; hãy dùng SGK hoặc tài liệu đang có."] if missing else []
    return RoadmapResponse(stages=stages, model=model, searchUsed=search_used, warnings=warnings)
