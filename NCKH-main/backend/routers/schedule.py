# Endpoint CRUD cho block học (SchedulePage.jsx).
# Mỗi chuỗi lặp lại lưu gọn 1 dòng: repeat / repeat_days / repeat_until
# (mặc định lặp liên tục đến 31/12 của năm chứa ngày bắt đầu).
# Sửa/xóa 1 buổi lẻ trong chuỗi dùng scope=single + exdates (kiểu Google Calendar).
from datetime import date as va_date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from auth import SupabaseUser, get_current_supabase_user
from schema import REPEAT_VALUES, ScheduleBlock, ScheduleBlockCreate, ScheduleBlockUpdate
from supabase_client import get_supabase_admin

router = APIRouter(prefix="/schedule", tags=["schedule"])

TABLE = "schedule_blocks"
COLUMNS = (
    "id,user_id,title,subject,date,start_time,end_time,tone,kind,"
    "repeat,repeat_days,repeat_until,exdates,created_at,updated_at"
)


def _db_error(error: Exception) -> None:
    if isinstance(error, HTTPException):
        raise error
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Database operation failed",
    ) from error


def _end_of_year(day: va_date) -> va_date:
    return va_date(day.year, 12, 31)


def _to_block(row: dict) -> ScheduleBlock:
    data = dict(row)
    # supabase-py có thể trả repeat_days/exdates là None -> chuẩn hóa về [].
    if data.get("repeat_days") is None:
        data["repeat_days"] = []
    if data.get("exdates") is None:
        data["exdates"] = []
    return ScheduleBlock.model_validate(data)


def _validate_rule(
    *,
    date: va_date,
    start_time: str,
    end_time: str,
    repeat: str,
    repeat_days: list[int],
    repeat_until: va_date | None,
) -> va_date | None:
    """Validate chéo các field repeat; trả về repeat_until đã chuẩn hóa."""
    if start_time >= end_time:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.",
        )
    if repeat not in REPEAT_VALUES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Giá trị repeat không hợp lệ.",
        )
    if any(not isinstance(d, int) or d < 0 or d > 6 for d in repeat_days):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="repeat_days chỉ gồm số 0 (CN) đến 6 (T7).",
        )
    if repeat == "none":
        return None
    if repeat == "custom" and not repeat_days:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Hãy chọn ít nhất một ngày trong tuần để lặp lại.",
        )
    until = repeat_until or _end_of_year(date)
    if until < date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày kết thúc lặp lại phải sau ngày bắt đầu.",
        )
    if until > _end_of_year(date):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Chuỗi lặp lại chỉ chạy đến hết năm (31/12).",
        )
    return until


def _fetch_one(block_id: UUID, user_id: UUID) -> dict:
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("id", str(block_id))
            .eq("user_id", str(user_id))
            .limit(1)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule block not found")
    return result.data[0]


def _overlaps(row: dict, from_day: va_date | None, to_day: va_date | None) -> bool:
    start = va_date.fromisoformat(str(row["date"]))
    repeat = row.get("repeat") or "none"
    if repeat == "none":
        return (from_day is None or start >= from_day) and (to_day is None or start <= to_day)
    until_raw = row.get("repeat_until")
    until = va_date.fromisoformat(str(until_raw)) if until_raw else _end_of_year(start)
    return (to_day is None or start <= to_day) and (from_day is None or until >= from_day)


@router.get("", response_model=list[ScheduleBlock])
def list_blocks(
    current: SupabaseUser = Depends(get_current_supabase_user),
    from_day: va_date | None = Query(default=None, alias="from"),
    to_day: va_date | None = Query(default=None, alias="to"),
) -> list[ScheduleBlock]:
    """Liệt kê block của chính mình, lọc theo khoảng ngày (VD: Month/Week view)."""
    if from_day and to_day and from_day > to_day:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'from' phải trước hoặc bằng ngày 'to'.",
        )
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .select(COLUMNS)
            .eq("user_id", str(current.id))
            .execute()
        )
    except Exception as error:
        _db_error(error)
    rows = [row for row in (result.data or []) if _overlaps(row, from_day, to_day)]
    rows.sort(key=lambda row: (str(row["date"]), str(row["start_time"]), str(row["id"])))
    return [_to_block(row) for row in rows]


@router.post("", response_model=ScheduleBlock, status_code=status.HTTP_201_CREATED)
def create_block(
    payload: ScheduleBlockCreate,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> ScheduleBlock:
    """Tạo block học mới (kèm rule lặp lại nếu có)."""
    until = _validate_rule(
        date=payload.date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        repeat=payload.repeat,
        repeat_days=payload.repeat_days,
        repeat_until=payload.repeat_until,
    )
    values = payload.model_dump(mode="json")
    values["user_id"] = str(current.id)
    values["repeat_until"] = until.isoformat() if until else None
    try:
        result = (
            get_supabase_admin().table(TABLE).insert(values).select(COLUMNS).execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_block(result.data[0])


@router.get("/{block_id}", response_model=ScheduleBlock)
def read_block(
    block_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
) -> ScheduleBlock:
    """Đọc 1 block của chính mình."""
    return _to_block(_fetch_one(block_id, current.id))


@router.put("/{block_id}", response_model=ScheduleBlock)
def update_block(
    block_id: UUID,
    payload: ScheduleBlockUpdate,
    current: SupabaseUser = Depends(get_current_supabase_user),
    scope: str = Query(default="series", pattern=r"^(series|single)$"),
    day: va_date | None = Query(default=None, description="Ngày của buổi lẻ khi scope=single"),
) -> ScheduleBlock:
    """Sửa block. scope=series: sửa cả chuỗi; scope=single&day=...: chỉ sửa 1 buổi
    (tách buổi đó thành block lẻ, buổi gốc được đưa vào exdates)."""
    row = _fetch_one(block_id, current.id)
    current_block = _to_block(row)

    if scope == "single" and current_block.repeat != "none":
        if day is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Thiếu query param 'day' (ngày của buổi cần sửa).",
            )
        return _update_single(current_block, day, payload, current.id)

    values = payload.model_dump(exclude_unset=True, mode="json")
    if not values:
        return current_block
    merged = {**current_block.model_dump(mode="json"), **values}
    until = _validate_rule(
        date=va_date.fromisoformat(str(merged["date"])),
        start_time=str(merged["start_time"]),
        end_time=str(merged["end_time"]),
        repeat=str(merged["repeat"]),
        repeat_days=list(merged.get("repeat_days") or []),
        repeat_until=va_date.fromisoformat(str(merged["repeat_until"])) if merged.get("repeat_until") else None,
    )
    values["repeat_until"] = until.isoformat() if until else None
    if str(merged["repeat"]) == "none":
        values["repeat_days"] = []
    try:
        result = (
            get_supabase_admin()
            .table(TABLE)
            .update(values)
            .eq("id", str(block_id))
            .eq("user_id", str(current.id))
            .select(COLUMNS)
            .execute()
        )
    except Exception as error:
        _db_error(error)
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule block not found")
    return _to_block(result.data[0])


def _update_single(
    parent: ScheduleBlock, day: va_date, payload: ScheduleBlockUpdate, user_id: UUID
) -> ScheduleBlock:
    """Tách 1 buổi lẻ ra khỏi chuỗi: parent thêm exdates, tạo block lẻ mới."""
    until = parent.repeat_until or _end_of_year(parent.date)
    if day < parent.date or day > until:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ngày 'day' không thuộc chuỗi lặp lại này.",
        )
    if day in (parent.exdates or []):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule block not found")
    override = payload.model_dump(exclude_unset=True, mode="json")
    if any(key in override for key in ("repeat", "repeat_days", "repeat_until")):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Sửa 1 buổi lẻ không đổi được rule lặp lại; hãy sửa cả chuỗi (scope=series).",
        )
    child_values: dict = {
        "user_id": str(user_id),
        "title": parent.title,
        "subject": parent.subject,
        "date": day.isoformat(),
        "start_time": parent.start_time,
        "end_time": parent.end_time,
        "tone": parent.tone,
        "kind": parent.kind,
        **override,
        # Buổi tách ra luôn là block lẻ, không mang rule repeat theo.
        "repeat": "none",
        "repeat_days": [],
        "repeat_until": None,
    }
    _validate_rule(
        date=va_date.fromisoformat(str(child_values["date"])),
        start_time=str(child_values["start_time"]),
        end_time=str(child_values["end_time"]),
        repeat="none",
        repeat_days=[],
        repeat_until=None,
    )
    try:
        created = (
            get_supabase_admin().table(TABLE).insert(child_values).select(COLUMNS).execute()
        )
        exdates = sorted({*(parent.exdates or []), day}, key=str)
        get_supabase_admin().table(TABLE).update(
            {"exdates": [d.isoformat() if isinstance(d, va_date) else str(d) for d in exdates]}
        ).eq("id", str(parent.id)).eq("user_id", str(user_id)).execute()
    except HTTPException:
        raise
    except Exception as error:
        _db_error(error)
    if not created.data:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database operation failed")
    return _to_block(created.data[0])


@router.delete("/{block_id}", response_model=ScheduleBlock | None)
def delete_block(
    block_id: UUID,
    current: SupabaseUser = Depends(get_current_supabase_user),
    scope: str = Query(default="series", pattern=r"^(series|single)$"),
    day: va_date | None = Query(default=None, description="Ngày của buổi lẻ khi scope=single"),
) -> ScheduleBlock | Response | None:
    """Xóa block. scope=series: xóa cả chuỗi (204); scope=single&day=...: chỉ bỏ
    1 buổi — thêm ngày đó vào exdates, giữ nguyên chuỗi (200 + chuỗi đã cập nhật)."""
    row = _fetch_one(block_id, current.id)
    block = _to_block(row)

    if scope == "single" and block.repeat != "none":
        if day is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Thiếu query param 'day' (ngày của buổi cần xóa).",
            )
        until = block.repeat_until or _end_of_year(block.date)
        if day < block.date or day > until:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ngày 'day' không thuộc chuỗi lặp lại này.",
            )
        if day in (block.exdates or []):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule block not found")
        exdates = sorted({*(block.exdates or []), day}, key=str)
        try:
            result = (
                get_supabase_admin()
                .table(TABLE)
                .update(
                    {"exdates": [d.isoformat() if isinstance(d, va_date) else str(d) for d in exdates]}
                )
                .eq("id", str(block_id))
                .eq("user_id", str(current.id))
                .select(COLUMNS)
                .execute()
            )
        except Exception as error:
            _db_error(error)
        if not result.data:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule block not found")
        return _to_block(result.data[0])

    try:
        get_supabase_admin().table(TABLE).delete().eq("id", str(block_id)).eq(
            "user_id", str(current.id)
        ).execute()
    except Exception as error:
        _db_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
