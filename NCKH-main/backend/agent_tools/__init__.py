"""Agent tools: short-memory + system prompt + web search dùng chung."""

from .short_memory import (
    DEFAULT_KEEP_LAST,
    MAX_CONTEXT_CHARS,
    MAX_FETCH_MESSAGES,
    MAX_SUMMARY_CHARS,
    PER_MESSAGE_TRUNCATE,
    TOOL_SPEC,
    SessionNotFoundError,
    build_short_memory,
    estimate_tokens,
    format_memory_for_llm,
    render_short_memory_context,
    summarize_older_messages,
    trim_messages_to_budget,
)
from .system_prompt import (
    AI_TONE_PROMPTS,
    AI_TONE_VALUES,
    MEMORY_PREFIX,
    STUDY_MODES,
    SUGGESTED_SUBJECTS,
    SYSTEM_PROMPT,
    build_chat_messages,
    format_student_context,
    get_system_prompt,
    get_tone_instruction,
    normalize_ai_tone,
)
from .web_search import (
    DEFAULT_MAX_RESULTS as WEB_SEARCH_DEFAULT_MAX_RESULTS,
)
from .web_search import (
    TOOL_SPEC as WEB_SEARCH_TOOL_SPEC,
)
from .web_search import (
    SEARCH_KEYWORDS,
    SearchUnavailableError,
    extract_search_query,
    format_results_for_llm,
    looks_like_search_request,
    search_documents,
)

__all__ = [
    "AI_TONE_PROMPTS",
    "AI_TONE_VALUES",
    "DEFAULT_KEEP_LAST",
    "MAX_CONTEXT_CHARS",
    "MAX_FETCH_MESSAGES",
    "MAX_SUMMARY_CHARS",
    "MEMORY_PREFIX",
    "PER_MESSAGE_TRUNCATE",
    "STUDY_MODES",
    "SUGGESTED_SUBJECTS",
    "SYSTEM_PROMPT",
    "TOOL_SPEC",
    "WEB_SEARCH_DEFAULT_MAX_RESULTS",
    "WEB_SEARCH_TOOL_SPEC",
    "SessionNotFoundError",
    "SEARCH_KEYWORDS",
    "SearchUnavailableError",
    "build_chat_messages",
    "build_short_memory",
    "estimate_tokens",
    "extract_search_query",
    "format_memory_for_llm",
    "format_student_context",
    "get_system_prompt",
    "get_tone_instruction",
    "looks_like_search_request",
    "normalize_ai_tone",
    "render_short_memory_context",
    "search_documents",
    "summarize_older_messages",
    "trim_messages_to_budget",
]
