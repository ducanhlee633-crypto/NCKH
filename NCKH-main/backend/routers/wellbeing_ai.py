# Router Wellbeing-AI: AI phân tích nhịp học từ dữ liệu DB thật.
# POST /api/wellbeing-ai/analyze — cần đăng nhập.
# Luồng: gom dữ liệu giống hệt GET /api/wellbeing/stress
# (deadlines, weekly_tasks, pomodoro_sessions, daily_tasks)
# rồi gọi services/stress.compute_stress (bản 4 tín hiệu)
# để lấy score/level/parts, sau đó gọi OpenRouter để sinh lời gợi ý
# cách cải thiện mà người dùng tự làm được. KHÔNG chẩn đoán bệnh.
from datetime import date as va_date
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from auth import SupabaseUser, get_current_supabase_user
from config import get_settings
from services.stress import compute_stress
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/wellbeing-ai", tags=["wellbeing-ai"])

DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

SYSTEM_PROMPT = (
    "Bạn là bạn cùng bàn tâm lý của trợ lý học tập Nhịp Học, giúp học sinh Việt Nam "
    "lớp 6-12 sắp xếp lại việc học khi tuần quá dày.\n"
    "Bạn nhận [Dữ liệu nhịp học] đã tính sẵn (điểm tải 0-100, mức, 4 mảnh, "
    "hạn nộp và việc tồn thật). Hãy phân tích ngắn gọn rồi gợi cách cải thiện mà bạn ấy "
    "TỰ LÀM được ngay.\n\n"
    "Quy tắc bắt buộc:\n"
    "- Xưng \"mình\" gọi \"bạn\", câu ngắn, ấm áp, không phán xét, không so sánh với người khác.\n"
    "- KHÔNG chẩn đoán bệnh tâm lý, KHÔNG chấm điểm tâm lý, KHÔNG nhắc XP/huy hiệu.\n"
    "- Chỉ dùng dữ liệu được cho, không bịa thêm deadline/việc.\n"
    "- Mức nguy_co (hoặc quá sức): ưu tiên nghỉ ngơi, không giao thêm bài, khuyên nói với "
    "cha mẹ/thầy cô tin cậy; nếu có dấu hiệu tự làm hại thì dừng dạy, khuyên tìm ngay người lớn.\n\n"
    "Trình bày bằng tiếng Việt, Markdown (app render sẵn):\n"
    "## Nhịp tuần này\n"
    "1-2 câu nhận xét tải (nhẹ/vừa/quá sức) + nguyên nhân chính (mảnh nào cao nhất).\n"
    "## 3 bước tự làm ngay\n"
    "- Mỗi bước 5-25 phút, cụ thể, gắn với hạn/việc thật (VD: làm 1 ý của hạn X trong 25 phút).\n"
    "## Nhắn thêm\n"
    "1 câu động viên + 1 câu hỏi mở (\"bạn muốn mình đồng hành phần nào trước?\")."
)


class WellbeingAiRequest(BaseModel):
    # Ghi chú thêm của học sinh (optional) để AI hiểu ngữ cảnh, tối đa 500 ký tự.
    note: str = Field(default="", max_length=500)


class WellbeingAiResponse(BaseModel):
    score: float
    level: str
    label: str
    advice: str
    model: str


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _parse_day(value: object) -> va_date | None:
    try:
        return va_date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _parse_moment(value: object) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment
    except ValueError:
        return None


def _short(text: object, limit: int = 60) -> str:
    return str(text or "").strip().replace("\n", " ")[:limit].strip()


@router.post("/analyze", response_model=WellbeingAiResponse)
def analyze_wellbeing(
    payload: WellbeingAiRequest | None = None,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> WellbeingAiResponse:
    """Gom dữ liệu thật -> tính điểm (bản 4 tín hiệu) -> nhờ AI gợi cách cải thiện."""
    note = _short((payload.note if payload else ""), 500)
    today = datetime.now(timezone.utc).date()
    week_ago = today - timedelta(days=7)
    user_id = str(current.id)
    try:
        db = get_supabase_admin()
        deadlines = (
            db.table("deadlines").select("due_date,status,title").eq("user_id", user_id).execute().data or []
        )
        weekly = (
            db.table("weekly_tasks").select("date,status,title").eq("user_id", user_id).execute().data or []
        )
        pomodoros = (
            db.table("pomodoro_sessions").select("started_at").eq("user_id", user_id).execute().data or []
        )
        daily = (
            db.table("daily_tasks").select("task_date,done,title").eq("user_id", user_id).execute().data or []
        )
    except Exception as error:
        _db_error(error)

    # --- Gom số liệu Y HỆT routers/wellbeing.my_stress ---
    deadline_count = 0
    upcoming_titles: list[str] = []
    overdue_titles: list[str] = []
    for row in deadlines:
        day = _parse_day(row.get("due_date"))
        if day is None or bool(row.get("status")):
            continue
        if (day - today).days > 7:
            continue
        deadline_count += 1
        title = _short(row.get("title"))
        if not title:
            continue
        if day < today and len(overdue_titles) < 5:
            overdue_titles.append(f"{title} (trễ từ {day.isoformat()})")
        elif day >= today and len(upcoming_titles) < 5:
            delta = (day - today).days
            upcoming_titles.append(f"{title} (còn {delta} ngày)")

    weekly_pending = 0
    pending_titles: list[str] = []
    for row in weekly:
        day = _parse_day(row.get("date")) if row.get("date") else today
        if day is None or day < week_ago or day > today:
            continue
        if str(row.get("status")) != "done":
            weekly_pending += 1
            if len(pending_titles) < 5 and _short(row.get("title")):
                pending_titles.append(_short(row.get("title")))

    night_sessions = 0
    for row in pomodoros:
        moment = _parse_moment(row.get("started_at"))
        if moment is None:
            continue
        day = moment.date()
        if day < week_ago or day > today:
            continue
        if moment.astimezone(VN_TZ).hour >= 22:
            night_sessions += 1

    today_pending = 0
    today_titles: list[str] = []
    for row in daily:
        day = _parse_day(row.get("task_date"))
        if day is None or day != today:
            continue
        if not row.get("done"):
            today_pending += 1
            if len(today_titles) < 5 and _short(row.get("title")):
                today_titles.append(_short(row.get("title")))

    result = compute_stress(
        deadline_count=deadline_count,
        weekly_pending=weekly_pending,
        night_sessions=night_sessions,
        today_pending=today_pending,
    )

    # --- Gọi AI phân tích từ dữ liệu thật ---
    settings = get_settings()
    api_key = (settings.openrouter_api_key or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dịch vụ AI chưa được cấu hình (thiếu OPENROUTER_API_KEY).",
        )
    model = (settings.openrouter_model or DEFAULT_MODEL).strip() or DEFAULT_MODEL

    user_prompt = (
        "[Dữ liệu nhịp học]\n"
        f"- Điểm tải: {result['score']}/100, mức: {result['level']} ({result['label']})\n"
        f"- 4 mảnh: deadline={result['parts']['deadline']}/35, "
        f"weekly={result['parts']['weekly']}/35, night={result['parts']['night']}/15, "
        f"today={result['parts']['today']}/15\n"
        f"- Deadline chưa xong (trễ + 7 ngày tới): {deadline_count}; "
        f"weekly tồn 7 ngày: {weekly_pending}; buổi quá 22h/tuần: {night_sessions}; "
        f"việc hôm nay chưa xong: {today_pending}.\n"
        f"- Hạn sắp tới: {'; '.join(upcoming_titles) if upcoming_titles else 'không có'}\n"
        f"- Đang trễ: {'; '.join(overdue_titles) if overdue_titles else 'không có'}\n"
        f"- Weekly còn tồn: {'; '.join(pending_titles) if pending_titles else 'không có'}\n"
        f"- Hôm nay còn tồn: {'; '.join(today_titles) if today_titles else 'không có'}\n"
        + (f"- Bạn ấy nhắn thêm: {note}\n" if note else "")
        + "Hãy phân tích và gợi 3 bước tự làm ngay."
    )

    try:
        from openai import OpenAI
    except ImportError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Backend thiếu thư viện openai. Hãy chạy pip install openai.",
        ) from error

    extra_headers: dict[str, str] = {}
    if settings.openrouter_site_url:
        extra_headers["HTTP-Referer"] = settings.openrouter_site_url
    if settings.openrouter_app_name:
        extra_headers["X-Title"] = settings.openrouter_app_name
    client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key, timeout=60.0)
    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=1500,
            stream=False,
            extra_headers=extra_headers or None,
            extra_body={"reasoning": {"effort": "low", "exclude": True}},
        )
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"OpenRouter lỗi: {error}") from error
    finally:
        try:
            client.close()
        except Exception:
            pass

    try:
        advice = (completion.choices[0].message.content or "").strip()
    except (AttributeError, IndexError):
        advice = ""
    if not advice:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI không trả về nội dung.")

    return WellbeingAiResponse(
        score=result["score"],
        level=result["level"],
        label=result["label"],
        advice=advice,
        model=model,
    )
