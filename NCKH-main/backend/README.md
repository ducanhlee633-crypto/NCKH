# Backend — Nhịp Học

FastAPI + Supabase (Auth + Postgres). Chạy cổng `8000`, prefix API `/api`.

## Thuật toán Chỉ số Tải học tập (Academic Load Index)

> Mục tiêu NCKH: phát hiện tuần học **dày hay thưa** từ dữ liệu hành vi có sẵn,
> để gợi 1 bước nhỏ vừa sức. **Không phải chẩn đoán y tế/tâm lý.**

### 1. Công thức (bản 4 tín hiệu)

```
Score = D(0-35) + W(0-35) + N(0/15) + T(0/7/15)  (tổng tròn 100)
```

| Mảnh | Ý nghĩa | Cách tính | Nguồn bảng |
|---|---|---|---|
| D deadline | Deadline chưa xong (trễ hạn + 7 ngày tới) | `0 cái=0, 1=12, 2=23, ≥3=35` | `deadlines` (`due_date`, `status=false`) |
| W weekly | Weekly task chưa xong 7 ngày qua | `0 tồn=0, 1-3=12, 4-5=23, ≥6=35` | `weekly_tasks` (`status=todo/doing`) |
| N night | Học quá 22h (giờ VN) ≥ 2 buổi/tuần | `≥2 buổi=15, còn lại=0` | `pomodoro_sessions` (`started_at` đổi sang `Asia/Ho_Chi_Minh`) |
| T today | Task trong ngày chưa xong | `0 tồn=0, 1-2=7, ≥3=15` | `daily_tasks` (`task_date=today`, `done=false`) |

### 2. Mức tải → giọng văn

| Điểm | `level` | Nhãn hiển thị | Hành động gợi ý |
|---|---|---|---|
| 0–30 | `nhe` | Nhẹ nhàng | Giữ khung 25–5 cho việc tiếp theo |
| 31–55 | `trung_binh` | Hơi dày | Cắt 1 việc nhẹ, làm 1 hạn gấp nhất trong 25 phút |
| 56–80 | `nang` | Quá sức | Ưu tiên nghỉ, không nhận việc mới, chia bài thành 1 ý duy nhất |
| > 80 (hoặc từ khóa nặng) | `nguy_co` | Cần nghỉ ngay | Dừng học, nói với cha mẹ/thầy cô tin cậy |

Khớp `LEVELS = (nhe, trung_binh, nang, nguy_co)` trong
`services/stress.py`.
Ngôn ngữ tuân `design.md`: xưng "bạn", không đua top, không nhiệt kế kỷ luật,
không hiện điểm đỏ gây lo — page `#/wellbeing` đặt tên **"Nhịp học tập"**.

### 3. API

| Method | Endpoint | Auth | Mô tả |
|---|---|---|---|
| `GET` | `/api/wellbeing/stress` | ✅ | Gom dữ liệu của chính mình, trả `{score, level, label, parts{deadline,weekly,night,today}, max, raw, inputs{...}, mode:"personal"}` |
| `POST` | `/api/wellbeing/stress/preview` | ❌ | Tính thử từ số liệu thủ công `{deadline_count, weekly_pending, night_sessions, today_pending}` → cùng shape + `mode:"preview"` |
| `POST` | `/api/wellbeing-ai/analyze` | ✅ | AI phân tích từ dữ liệu DB thật (gom y hệt `/stress` + tên hạn/việc tồn), giữ nguyên `compute_stress`, trả `{score, level, label, advice, model}` — frontend chỉ hiện thanh điểm + nút này |

Code thuần ở `services/stress.py` (`compute_stress()` — dễ unit-test, không cần ML lib),
gom dữ liệu ở `routers/wellbeing.py`, AI phân tích ở `routers/wellbeing_ai.py`,
đã mount trong `routers/__init__.py`.
Frontend: `pages/WellbeingPage.jsx` (`#/wellbeing`) chỉ hiện thanh điểm + nút AI + `fetchStress()/fetchWellbeingAdvice()` trong `backendApi.js`.

### 4. Giới hạn & hướng NCKH tiếp theo

- Proxy giờ đêm đang dùng giờ UTC của `started_at` (lệch ~7h so với VN) — cần chuẩn hóa múi giờ khi có dữ liệu thật.
- Chưa có nhãn chủ quan (khảo sát 1 câu/ngày) nên chưa train ML được; hướng phát triển:
  thu nhãn PSS-10 rút gọn → Logistic Regression / Random Forest so với baseline rule này.
- Đánh giá hiện tại: giả lập 3 kịch bản (tuần nhẹ / thi giữa kỳ / dồn 5 deadline)
  + đối chiếu thủ công với GV trên 20–30 tài khoản thật.

## Chạy backend (dev)

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --host 127.0.0.1 --port 8000
uv run pytest
```

Kiểm tra: `GET http://127.0.0.1:8000/api/health` → `{"status":"ok"}`.
Docs: `http://127.0.0.1:8000/docs`.
