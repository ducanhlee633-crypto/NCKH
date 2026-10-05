"""Danh mục môn học dùng chung toàn backend (single source of truth).

Bối cảnh: trước đây tên môn nằm rải rác — Pomodoro khóa cứng 9 nhãn ngắn,
form Lịch học/Lộ trình gợi ý "Toán, Ngữ văn, Tiếng Anh", AI gợi ý 3 môn.
File này gom về một chỗ để cả ba luôn đồng bộ:

- POMODORO_SUBJECT_VALUES: nhãn khóa cứng cho phiên focus (khớp CHECK
  `pomodoro_sessions_subject_check` trong supabase/schema.sql). Giữ nguyên
  9 tên ngắn cũ (Toán, Lí, Hoá, Văn, Sinh, Sử, Địa, Tin, Dự án) để không vỡ
  dữ liệu đã lưu, chỉ THÊM "Tiếng Anh" (môn chính bị thiếu), "KHTN" (môn tích
  hợp THCS) và "GDCD". Muốn thêm môn mới: thêm vào tuple này + chạy lại
  schema.sql (có migration thay constraint an toàn) + mirror sang
  frontend/src/data/subjects.js.
- SCHOOL_SUBJECTS: tên đầy đủ thân thiện để gợi ý ở form tự do (Lịch học,
  Lộ trình, Hạn nộp) và cho AI hiểu học sinh đang hỏi môn gì.
- SUBJECT_ALIASES / normalize_subject: map tên đầy đủ, viết tắt, sai
  chính tả nhẹ (Vật lý/Vật lí, Địa lý/Địa lí) về đúng nhãn Pomodoro để AI
  và thống kê không chia một môn thành hai.
"""

import re

# Nhãn khóa cứng cho phiên focus — KHỚP DB CHECK, đổi kèm migration.
POMODORO_SUBJECT_VALUES = (
    "Toán",
    "Lí",
    "Hoá",
    "Văn",
    "Sinh",
    "Sử",
    "Địa",
    "Tin",
    "Dự án",
    "Tiếng Anh",
    "KHTN",
    "GDCD",
)

POMODORO_SUBJECT_PATTERN = r"^(" + "|".join(re.escape(v) for v in POMODORO_SUBJECT_VALUES) + r")$"

# Tên đầy đủ để gợi ý ở form tự do (datalist Lịch học/Lộ trình, AI, Stats).
SCHOOL_SUBJECTS = (
    "Toán",
    "Ngữ văn",
    "Tiếng Anh",
    "Vật lí",
    "Hóa học",
    "Sinh học",
    "Lịch sử",
    "Địa lí",
    "Khoa học tự nhiên",
    "Tin học",
    "Công nghệ",
    "GDCD",
)

# Tên gọi khác -> nhãn Pomodoro chuẩn (so sánh sau khi strip + lower).
SUBJECT_ALIASES = {
    "ngữ văn": "Văn",
    "văn": "Văn",
    "vật lí": "Lí",
    "vật lý": "Lí",
    "lí": "Lí",
    "lý": "Lí",
    "hóa học": "Hoá",
    "hoá học": "Hoá",
    "hóa": "Hoá",
    "hoá": "Hoá",
    "sinh học": "Sinh",
    "sinh": "Sinh",
    "lịch sử": "Sử",
    "sử": "Sử",
    "địa lí": "Địa",
    "địa lý": "Địa",
    "địa": "Địa",
    "tin học": "Tin",
    "tin": "Tin",
    "tiếng anh": "Tiếng Anh",
    "anh văn": "Tiếng Anh",
    "khoa học tự nhiên": "KHTN",
    "khtn": "KHTN",
    "giáo dục công dân": "GDCD",
    "gdcd": "GDCD",
    "giáo dục quốc phòng": "Dự án",
    "dự án": "Dự án",
}

_LOOKUP = {v.lower(): v for v in POMODORO_SUBJECT_VALUES} | SUBJECT_ALIASES


def normalize_subject(name: str | None) -> str:
    """Chuẩn hóa tên môn về nhãn Pomodoro; tên lạ giữ nguyên (đã strip).

    VD: " ngữ văn " -> "Văn", "Vật lý" -> "Lí", "Thể dục" -> "Thể dục".
    """
    text = str(name or "").strip()
    if not text:
        return ""
    return _LOOKUP.get(text.lower(), text)


def pomodoro_subject_error() -> str:
    """Câu báo lỗi 422 tự sinh từ tuple — thêm môn không phải sửa string tay."""
    return "Môn học phải là một trong: " + ", ".join(POMODORO_SUBJECT_VALUES) + "."
