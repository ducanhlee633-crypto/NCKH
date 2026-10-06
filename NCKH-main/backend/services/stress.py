"""Thuật toán Chỉ số Tải học tập (Academic Load Index) — bản 4 tín hiệu.

Rule-based, giải thích được, không cần huấn luyện — phù hợp NCKH cấp trường.
Score = D(0-35) + W(0-35) + N(0/15) + T(0/7/15), tổng tròn 100.
KHÔNG chẩn đoán bệnh tâm lý.
"""

from __future__ import annotations

LEVELS = ("nhe", "trung_binh", "nang", "nguy_co")

LEVEL_LABEL = {
    "nhe": "Nhẹ nhàng",
    "trung_binh": "Hơi dày",
    "nang": "Quá sức",
    "nguy_co": "Cần nghỉ ngay",
}

# Điểm tối đa từng mảnh — tổng tròn 100, cộng trực tiếp ra Score.
MAX = {
    "deadline": 35,  # D: deadline chưa xong (trễ hạn + 7 ngày tới)
    "weekly": 35,  # W: weekly task chưa xong 7 ngày qua
    "night": 15,  # N: học quá 22h (giờ VN) >= 2 buổi/tuần
    "today": 15,  # T: task trong ngày chưa xong
}


def score_deadline_count(count: int) -> int:
    """D: 0 cái = 0, 1 = 12, 2 = 23, >= 3 = 35."""
    count = max(0, int(count or 0))
    if count >= 3:
        return 35
    if count == 2:
        return 23
    if count == 1:
        return 12
    return 0


def score_weekly_backlog(pending: int) -> int:
    """W: 0 tồn = 0, 1-3 tồn = 12, 4-5 tồn = 23, >= 6 tồn = 35."""
    pending = max(0, int(pending or 0))
    if pending >= 6:
        return 35
    if pending >= 4:
        return 23
    if pending >= 1:
        return 12
    return 0


def score_night_22h(night_sessions: int) -> int:
    """N: học quá 22h (giờ VN) >= 2 buổi/tuần -> 15, còn lại 0."""
    return 15 if max(0, int(night_sessions or 0)) >= 2 else 0


def score_today_todo(pending_today: int) -> int:
    """T: việc trong ngày chưa xong: 0 = 0, 1-2 = 7, >= 3 = 15."""
    pending_today = max(0, int(pending_today or 0))
    if pending_today >= 3:
        return 15
    if pending_today >= 1:
        return 7
    return 0


def level_of(score_100: float) -> str:
    score = max(0.0, min(100.0, float(score_100 or 0)))
    if score > 80:
        return "nguy_co"
    if score > 55:
        return "nang"
    if score > 30:
        return "trung_binh"
    return "nhe"


def compute_stress(
    *,
    deadline_count: int = 0,
    weekly_pending: int = 0,
    night_sessions: int = 0,
    today_pending: int = 0,
) -> dict:
    """Tính điểm 0-100 + mức. Hàm thuần, dễ unit-test."""
    parts = {
        "deadline": score_deadline_count(deadline_count),
        "weekly": score_weekly_backlog(weekly_pending),
        "night": score_night_22h(night_sessions),
        "today": score_today_todo(today_pending),
    }
    raw = sum(parts.values())
    score = round(min(100.0, float(raw)), 1)
    level = level_of(score)
    return {
        "score": score,
        "level": level,
        "label": LEVEL_LABEL[level],
        "parts": dict(parts),
        "max": dict(MAX),
        "raw": raw,
    }
