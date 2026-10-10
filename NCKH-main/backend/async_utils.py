"""Helpers chạy code sync blocking trong threadpool để event loop không bị nghẽn.

Toàn bộ I/O bên dưới (supabase-py sync, OpenAI sync, DDGS, pywebpush,
Supabase Auth GoTrue) đều là HTTP blocking. Mọi router endpoint là
`async def` và bọc các call blocking bằng `run_blocking` (tức
`asyncio.to_thread`), nhờ đó 1 worker uvicorn phục vụ được nhiều
request đồng thời thay vì đứng đợi từng request như trước.

Dùng `asyncio.gather` với nhiều `run_blocking` khi các query độc lập
(VD: 4 query wellbeing) để chạy song song.
"""

import asyncio
from collections.abc import Callable
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
T = TypeVar("T")


async def run_blocking(func: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    """Chạy hàm sync blocking trong threadpool, trả kết quả (hoặc ném exception gốc)."""
    return await asyncio.to_thread(func, *args, **kwargs)
