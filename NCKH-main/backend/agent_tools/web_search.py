"""Search tool (DuckDuckGo) cho agent.

Khi học sinh kêu "tìm tài liệu...", agent gọi tool này để search web
và trả về link tài liệu (title + url + snippet).

Cách dùng trong agent/router:
    from agent_tools.web_search import search_documents, format_results_for_llm
    from agent_tools.web_search import looks_like_search_request, extract_search_query

Quy ước giống short_memory.py: TOOL_SPEC theo format function-calling
của OpenAI/OpenRouter, hàm pure dễ test, lỗi mạng gom về SearchUnavailableError.
"""

import re
from typing import Any
from urllib.parse import urlparse

DEFAULT_MAX_RESULTS = 5
MAX_RESULTS_LIMIT = 10
MAX_QUERY_CHARS = 300
SEARCH_TIMEOUT = 15.0
SEARCH_REGION = "vn-vi"
SNIPPET_CHARS = 300

# Domain tài liệu/giáo dục tiếng Việt được ưu tiên xếp lên trước.
# (Chỉ là boost thứ hạng, không loại kết quả khác.)
EDU_DOMAINS = (
    "loigiaihay.com",
    "vietjack.com",
    "vndoc.com",
    "hoc247.net",
    "tuyensinh247.com",
    "hoctapsgk.com",
    "hocmai.vn",
    "moon.vn",
)
DOC_EXTENSIONS = (".pdf", ".doc", ".docx", ".ppt", ".pptx")

_VIETNAMESE_RE = re.compile(
    r"[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]",
    re.IGNORECASE,
)

# Mô tả tool cho agent/function-calling (OpenAI/OpenRouter format,
# giống short_memory.TOOL_SPEC).
TOOL_SPEC: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": (
            "Tìm tài liệu học tập trên web bằng DuckDuckGo. "
            "Dùng khi học sinh nhờ tìm tài liệu, đề thi, bài giảng, sách. "
            "Trả về danh sách tiêu đề + link + mô tả ngắn."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Từ khóa tìm kiếm, đã tách khỏi câu nhờ vả (VD: 'phương trình bậc 2 lớp 9').",
                },
                "max_results": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_RESULTS_LIMIT,
                    "default": DEFAULT_MAX_RESULTS,
                    "description": "Số link tối đa trả về.",
                },
            },
            "required": ["query"],
        },
    },
}

# Cụm từ cho thấy học sinh đang nhờ tìm tài liệu (dùng cho nhánh fallback
# khi model không hỗ trợ function-calling).
SEARCH_KEYWORDS = (
    "tìm tài liệu",
    "tìm giúp",
    "tìm hộ",
    "tìm jum",
    "tìm đề",
    "tìm bài",
    "tìm link",
    "tìm sách",
    "tài liệu về",
    "tài liệu cho",
    "link tài liệu",
    "xin tài liệu",
)


class SearchUnavailableError(RuntimeError):
    """Search hỏng (mất mạng, DuckDuckGo rate-limit, thiếu thư viện) để caller fallback."""


def score_result(url: str, title: str = "") -> int:
    """Chấm điểm ưu tiên tài liệu học tập: file PDF/DOC +3/+2, domain giáo dục +2, tiêu đề tiếng Việt +1."""
    try:
        parts = urlparse(str(url or ""))
    except ValueError:
        return 0
    host = parts.netloc.lower()
    path = parts.path.lower()
    score = 0
    if path.endswith(".pdf") or "/pdf" in path:
        score += 3
    elif any(ext in path for ext in DOC_EXTENSIONS):
        score += 2
    if host in EDU_DOMAINS or host.endswith(".edu.vn"):
        score += 2
    if _VIETNAMESE_RE.search(str(title or "")):
        score += 1
    return score


def looks_like_search_request(text: str) -> bool:
    """Câu hỏi có phải đang nhờ tìm tài liệu không (soi từ khóa, không gọi LLM)."""
    lowered = re.sub(r"\s+", " ", str(text or "").lower()).strip()
    if not lowered:
        return False
    if any(keyword in lowered for keyword in SEARCH_KEYWORDS):
        return True
    return bool(re.search(r"\bsearch\b", lowered))


# Chỉ bóc động từ nhờ vả + từ phụ, GIỮ lại danh từ ("đề thi", "bài tập",
# "sách giáo khoa" là một phần của từ khóa, không được nuốt).
_TRIGGER_RE = re.compile(
    r"(?:tìm\s+(?:tài\s+liệu|giúp|hộ|jum|link)?|xin\s+(?:tài\s+liệu)?|link\s+tài\s+liệu|tài\s+liệu)"
    r"\s*(?:về|cho|với|chủ đề)?\s*",
    re.IGNORECASE,
)
_TAIL_TOKENS = ("giúp mình", "hộ mình", "jum mình", "nhé", "nha", "với ạ", "với", "ạ")
# Từ xưng hô lịch sự còn sót lại ngay sau cụm kích hoạt ("tìm giúp mình đề thi..." -> "đề thi...").
_LEAD_TOKENS = ("mình", "mk", "tớ", "em", "anh", "chị", "bạn", "search")


def extract_search_query(text: str) -> str:
    """Tách từ khóa search khỏi câu nhờ vả. VD: 'tìm tài liệu về este nhé' -> 'este'."""
    collapsed = re.sub(r"\s+", " ", str(text or "")).strip()
    if not collapsed:
        return ""
    # Lấy cụm trigger DÀI nhất (tránh cắt nhầm ở "tìm hiểu..." khi câu có
    # trigger thật ở sau). Không khớp thì giữ nguyên cả câu làm từ khóa.
    candidates = list(_TRIGGER_RE.finditer(collapsed))
    if candidates:
        best = max(candidates, key=lambda m: (m.end() - m.start(), -m.start()))
        query = collapsed[best.end():].strip()
    else:
        query = collapsed
    query = query.rstrip("?.!…").strip()
    lowered_query = query.lower()
    # Bóc từ xưng hô ở đầu ("mình đề thi..." -> "đề thi...").
    changed = True
    while changed:
        changed = False
        for token in _LEAD_TOKENS:
            if lowered_query.startswith(token + " "):
                query = query[len(token):].strip()
                lowered_query = query.lower()
                changed = True
                break
    # Bóc đuôi lịch sự ở cuối, lặp đến khi hết ("este giúp mình nhé" -> "este").
    changed = True
    while changed:
        changed = False
        for token in _TAIL_TOKENS:
            if lowered_query.endswith(" " + token):
                query = query[: -len(token)].rstrip("?.!… ").strip()
                lowered_query = query.lower()
                changed = True
                break
    if not query:
        query = collapsed
    # Chỉ còn toàn từ lịch sự ("tìm tài liệu giúp mình" mà không nêu chủ đề)
    # thì giữ nguyên cả câu — DDG vẫn bắt được chủ đề nằm ở nửa đầu câu.
    if query.lower() in _TAIL_TOKENS:
        query = collapsed
    return query[:MAX_QUERY_CHARS].rstrip()


def _normalize_url(url: str) -> str:
    """Key khử trùng: host + path thường, bỏ query/fragment và '/' cuối."""
    try:
        parts = urlparse(str(url or "").strip())
    except ValueError:
        return str(url or "").strip().lower()
    return (parts.netloc.lower() + parts.path.rstrip("/").lower()) or str(url or "").strip().lower()


def search_documents(query: str, max_results: int = DEFAULT_MAX_RESULTS) -> list[dict[str, str]]:
    """Search DuckDuckGo, trả về tối đa max_results link [{title, url, snippet}].

    Ưu tiên file tài liệu + domain giáo dục VN (giữ thứ hạng DDG khi đồng điểm).
    Raises:
        ValueError: query rỗng.
        SearchUnavailableError: lỗi mạng / rate-limit / thiếu thư viện ddgs.
    """
    cleaned = re.sub(r"\s+", " ", str(query or "")).strip()
    if not cleaned:
        raise ValueError("Từ khóa tìm kiếm không được để trống.")
    cleaned = cleaned[:MAX_QUERY_CHARS].rstrip()
    try:
        limit = int(max_results)
    except (TypeError, ValueError):
        limit = DEFAULT_MAX_RESULTS
    limit = max(1, min(MAX_RESULTS_LIMIT, limit))
    try:
        from ddgs import DDGS
    except ImportError as error:
        raise SearchUnavailableError("Chưa cài thư viện tìm kiếm (ddgs). Hãy chạy: uv add ddgs") from error
    try:
        raw = DDGS(timeout=SEARCH_TIMEOUT).text(
            cleaned, region=SEARCH_REGION, safesearch="moderate", max_results=limit * 2
        )
    except Exception as error:
        raise SearchUnavailableError(f"DuckDuckGo lỗi: {error}") from error
    seen: set[str] = set()
    scored: list[tuple[int, dict[str, str]]] = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("href", "") or "").strip()
        if not url or not url.startswith("http"):
            continue
        key = _normalize_url(url)
        if key in seen:
            continue
        seen.add(key)
        title = re.sub(r"\s+", " ", str(item.get("title", "") or "")).strip() or url
        snippet = re.sub(r"\s+", " ", str(item.get("body", "") or "")).strip()
        if len(snippet) > SNIPPET_CHARS:
            snippet = snippet[:SNIPPET_CHARS].rstrip() + "…"
        scored.append((score_result(url, title), {"title": title, "url": url, "snippet": snippet}))
    # Sort ổn định: đồng điểm giữ nguyên thứ hạng DDG.
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [doc for _, doc in scored[:limit]]


def format_results_for_llm(results: list[dict[str, Any]] | None, query: str = "") -> str:
    """Render kết quả search thành đoạn text để model tóm tắt + liệt kê link."""
    items = [r for r in (results or []) if isinstance(r, dict) and r.get("url")]
    if not items:
        return ""
    label = (str(query or "").strip() or "tài liệu học tập")[:MAX_QUERY_CHARS]
    lines = [f'Kết quả tìm kiếm DuckDuckGo cho "{label}" ({len(items)} kết quả):']
    for index, item in enumerate(items, 1):
        lines.append(f"{index}. {item.get('title') or item['url']}")
        lines.append(f"   Link: {item['url']}")
        if item.get("snippet"):
            lines.append(f"   Mô tả: {item['snippet']}")
    lines.append(
        "Hãy tóm tắt ngắn gọn bằng tiếng Việt và liệt kê các link trên "
        "để học sinh bấm vào đọc tiếp. Không bịa thêm link."
    )
    return "\n".join(lines)
