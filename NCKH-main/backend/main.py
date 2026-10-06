import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import router as api_router

app = FastAPI()
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# Domain frontend production (Vercel) truyền qua env FRONTEND_URL trên Render.
# Ví dụ: FRONTEND_URL=https://nhip-hoc.vercel.app
# Hỗ trợ nhiều domain cách nhau bằng dấu phẩy.
frontend_urls = os.getenv("FRONTEND_URL", "")
for url in [u.strip().rstrip("/") for u in frontend_urls.split(",")]:
    if url and url not in origins:
        origins.append(url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # Cho phép mọi preview deployment của Vercel (xxx-*.vercel.app)
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")



@app.get("/api/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    # Render cấp PORT động, bắt buộc bind 0.0.0.0.
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
