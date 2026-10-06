# Nhịp Học — Sổ học tập cho học sinh 6–12

Ứng dụng web giúp học sinh Việt Nam (lớp 6–12) biết **hôm nay cần học gì tiếp theo**:
quản lý việc cần làm, lịch học, hạn nộp, lộ trình học, mục tiêu, phòng tập trung
Pomodoro 25/5, thống kê tiến bộ, bạn bè và trợ lý học tập.

> Triết lý giao diện: **“Sổ học tập của bạn”** — hành động học tập đặt trước số liệu,
> không dùng XP / chuỗi học / huy hiệu giả. Chi tiết xem `design.md`.

## Tính năng chính

| Nhóm | Mô tả |
|---|---|
| Góc học tập (`#/dashboard`) | Lời chào theo ngày, bước học tiếp theo, lịch tuần (bắt đầu thứ Hai), việc cần làm (Tất cả / Chưa xong / Đã xong), hạn nộp 7 ngày tới, phút tập trung hôm nay |
| Lịch học (`#/schedule`) | Gộp 3 nguồn: lịch tự thêm + bài trong lộ trình + hạn nộp; giờ nộp hiển thị rõ; định dạng ngày VN, giờ 24h |
| Hạn nộp | Thêm / sửa / xóa hạn nộp theo môn, có giờ nộp |
| Phòng tập trung (`#/pomodoro`) | Chu kỳ 25 phút học – 5 phút nghỉ (+ nghỉ dài tùy chọn); chỉ tính phiên đã hoàn thành |
| Lộ trình học (`#/roadmap`) | Chia nội dung thành các bài học nhỏ |
| Mục tiêu (`#/goals`) | Mục tiêu kèm hạn hoàn thành |
| Tiến bộ (`#/stats`) | Bài + thời lượng thực tế, lọc tuần / tháng / năm học (năm học tính từ tháng 9) |
| Trợ lý học tập (`#/assistant`) | 4 cách hỏi: gợi ý cách giải, kế hoạch ôn, hiểu kiến thức, tự kiểm tra. Chưa nối AI thì nói rõ và chỉ lưu câu hỏi trên thiết bị |
| Bạn bè (`#/friends`) | Kết nối bạn học |
| Cài đặt / Trợ giúp | Hồ sơ lớp 6–12 (THCS/THPT), chủ đề màu, chế độ tối; trạng thái lưu “trên thiết bị”, không giả vờ đã sao lưu tài khoản |

## Kiến trúc & công nghệ

```text
NCKH-main/
├── backend/    # FastAPI + Supabase (Auth + Postgres)
├── frontend/   # React 19 + Vite 8, hash-routing (#/dashboard, #/schedule, ...)
└── design.md   # Quy chuẩn giao diện "Sổ học tập"
```

- **Backend:** FastAPI, pydantic-settings, PyJWT, supabase-py. Chạy cổng `8000`, prefix API `/api`.
- **Frontend:** React 19, react-dom, axios, Vite (proxy `/api` → backend). Chạy cổng `5173`.
- **Auth:** Supabase Auth. Backend verify JWT tại chỗ nếu có `SUPABASE_JWT_SECRET`, ngược lại gọi Supabase Auth API.
- **Dữ liệu:** Supabase Postgres, schema tại `backend/supabase/schema.sql`.
- **API chính** (`backend/routers/`): `user`, `auth`, `user_preferences`, `schedule`, `deadlines`, `pomodoro`, `friends`, `feedback` + `GET /api/health`.

## Yêu cầu

- Python `>= 3.14` (khuyên dùng [uv](https://docs.astral.sh/uv/))
- Node.js `>= 20` + npm
- Một project Supabase (lấy `URL`, `anon key`, `service_role key`, `JWT Secret`)

## Cài đặt nhanh (dev)

### 1. Clone & cấu hình môi trường

```bash
git clone <repo-url>
cd NCKH-main

# Backend
cp backend/.env.example backend/.env
# -> mở backend/.env điền SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#    SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET

# Frontend
cp frontend/.env.example frontend/.env
# -> dev có thể để trống VITE_API_URL (Vite proxy /api về BACKEND_URL,
#    mặc định http://127.0.0.1:8000). Khi deploy mới cần VITE_API_URL.
```

Nội dung `backend/.env` cần có:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_JWT_SECRET=your-supabase-jwt-secret
```

### 2. Dựng database Supabase

Chạy file `backend/supabase/schema.sql` trong Supabase Dashboard → SQL Editor
(áp dụng bảng cho schedule, deadlines, pomodoro, friends, feedback, preferences...).

### 3. Chạy backend (FastAPI)

```bash
cd backend
uv sync          # lần đầu: tạo .venv + cài deps từ pyproject.toml / uv.lock
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
# hoặc: uv run python main.py
```

Kiểm tra: mở http://127.0.0.1:8000/api/health → `{"status":"ok"}`.
Docs tự động: http://127.0.0.1:8000/docs

### 4. Chạy frontend (React + Vite)

Mở terminal mới:

```bash
cd frontend
npm install
npm run dev
```

Mở http://localhost:5173 → tự chuyển về `#/login` nếu chưa đăng nhập.
Đăng ký / đăng nhập bằng Supabase Auth, sau đó dùng `#/dashboard`.

> Frontend gọi API qua `/api` (proxy về `BACKEND_URL`, mặc định `http://127.0.0.1:8000`
> theo `vite.config.js`). Muốn trỏ backend khác: `BACKEND_URL=http://... npm run dev`.

## Build & kiểm tra production

```bash
# Frontend: lint + build + preview
cd frontend
npm run lint
npm run build
npm run preview   # phục vụ dist/ để kiểm tra

# Backend: chạy test API
cd backend
uv run pytest
```

Quy trình đã kiểm tra theo `design.md`: build production, lint, render SSR 10 trang
(với dữ liệu trống + dữ liệu mẫu), lịch gộp đủ 3 nguồn, lớp học và phút tập trung đúng.
Chưa kiểm tra bằng trình duyệt thật ở 320 / 390 / 768 / 1440px + chế độ tối +
điều hướng bàn phím — cần đối chiếu khi có trình duyệt kiểm thử.

## Cấu trúc thư mục

```text
backend/
├── main.py            # FastAPI app, CORS cho localhost:5173, mount /api
├── config.py          # Đọc backend/.env qua pydantic-settings
├── auth.py            # Verify Supabase JWT
├── routers/           # user, auth, user_preferences, schedule,
│                      # deadlines, pomodoro, friends, feedback
├── supabase/schema.sql# Schema Postgres
└── test_routes.py     # Test API (pytest)

frontend/
├── src/
│   ├── App.jsx        # Hash-routing + guard đăng nhập
│   ├── backendApi.js  # Gọi /api, đồng bộ session Supabase
│   ├── pages/         # Dashboard, Schedule, Pomodoro, Roadmap,
│   │                  # Goals, Stats, Friends, AIAssistant, Settings, Help, Auth
│   ├── components/    # AppShell, Icon, PageComponents (dùng chung)
│   ├── data/          # navigation, calendar (calendarEvents gộp lịch)
│   └── styles/        # app-shell, từng trang + student-design.css (quy chuẩn chung)
└── vite.config.js     # Proxy /api → BACKEND_URL
```

## Xử lý sự cố

| Lỗi | Cách sửa |
|---|---|
| Backend báo thiếu `SUPABASE_SERVICE_ROLE_KEY` | Điền key vào `backend/.env` (không commit file này) |
| Frontend gọi `/api` 404 / CORS | Đảm bảo backend chạy ở `127.0.0.1:8000`, hoặc set `BACKEND_URL` khi chạy Vite |
| Đăng nhập xong vẫn về trang login | Kiểm tra Supabase Auth (confirm email, anon key đúng project) |
| Bấm link xác nhận email không về app/onboarding | Supabase Dashboard > Authentication > URL Configuration: Site URL = domain frontend, Redirect URLs thêm `https://<domain>/?verified=1` (local: `http://localhost:5173/?verified=1`); backend set `FRONTEND_URL` trùng domain |
| `npm run build` lỗi | `node -v` phải ≥ 20; xóa `node_modules` rồi `npm install` lại |

## Tài liệu liên quan

- `design.md` — quy chuẩn màu, chữ, bố cục, giọng văn, checklist kiểm thử.
- `backend/supabase/schema.sql` — schema database.
- http://127.0.0.1:8000/docs — API docs tự sinh khi backend đang chạy.
