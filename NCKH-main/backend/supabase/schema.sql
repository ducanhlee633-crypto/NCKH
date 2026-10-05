-- =====================================================================
-- Nhịp Học — Supabase schema (Supabase Auth làm nguồn sự thật tài khoản)
--
-- Cách chạy: Supabase Dashboard > SQL Editor > dán toàn bộ file > Run.
-- Yêu cầu: bật Email provider (Authentication > Providers > Email).
-- Nếu muốn user đăng nhập ngay không cần bấm link xác nhận:
--   Authentication > Providers > Email > tắt "Confirm email".
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Bảng profiles: hồ sơ mở rộng của auth.users, KHÔNG lưu password.
--    id = auth.users.id (do trigger handle_new_user tự điền khi signup).
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  name text not null default '',
  nickname text,
  grade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_.-]{3,64}$'),
  constraint profiles_nickname_format check (nickname is null or nickname ~ '^[a-z0-9_.-]{3,64}$'),
  constraint profiles_name_length check (char_length(name) between 0 and 120),
  constraint profiles_grade_check check (grade is null or grade in ('6', '7', '8', '9', '10', '11', '12'))
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username)) where username is not null;

-- ---------------------------------------------------------------------
-- 1b. Migration cho DB đã có: thêm cột nickname nếu chưa có + backfill.
--     LƯU Ý: ALTER phải chạy TRƯỚC create index nickname,
--     vì DB cũ chưa có cột này (lỗi 42703 nếu tạo index trước).
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists nickname text;

do $$
begin
  -- Backfill nickname từ username (lower) cho các dòng cũ chưa có nickname.
  update public.profiles
  set nickname = lower(username)
  where nickname is null and username is not null;
exception when others then
  -- Bỏ qua nếu unique conflict (nickname trùng nhau từ dữ liệu cũ).
  null;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_nickname_format') then
    alter table public.profiles
      add constraint profiles_nickname_format check (nickname is null or nickname ~ '^[a-z0-9_.-]{3,64}$');
  end if;
end
$$;

create unique index if not exists profiles_nickname_lower_idx
  on public.profiles (lower(nickname)) where nickname is not null;

-- ---------------------------------------------------------------------
-- 1c. Migration cho DB đã có: thêm cột lớp (grade) nếu chưa có.
--     Lớp 6..12 (text, NULL = chưa chọn). Chạy an toàn nhiều lần.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists grade text;

-- Chuẩn hóa dữ liệu lạ (VD: '', 'Lớp 6', số ngoài 6..12) về NULL trước khi gắn CHECK.
update public.profiles
set grade = null
where grade is not null
  and grade not in ('6', '7', '8', '9', '10', '11', '12');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_grade_check') then
    alter table public.profiles
      add constraint profiles_grade_check check (grade is null or grade in ('6', '7', '8', '9', '10', '11', '12'));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Migrate dữ liệu từ bảng cũ `profile` (tự quản password_hash) nếu có.
--    Chỉ giữ các dòng trùng id với auth.users; password_hash bị LOẠI BỎ
--    vì Supabase Auth đã quản lý credentials. User cũ cần Đăng ký lại.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profile') is not null then
    insert into public.profiles (id, username, name)
    select p.id, lower(p.username), p.name
    from public.profile p
    join auth.users u on u.id = p.id
    on conflict (id) do nothing;
    -- Giữ bảng cũ làm backup, đổi tên để code mới không đọc nhầm.
    if to_regclass('public.profile_legacy') is null then
      alter table public.profile rename to profile_legacy;
    end if;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 3. Trigger: tự tạo profile mỗi khi có auth.users mới (signup thành công).
--    Lấy username/name/nickname/grade từ raw_user_meta_data do backend gửi lên.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_username text := nullif((new.raw_user_meta_data ->> 'username'), '');
  meta_name text := coalesce(nullif((new.raw_user_meta_data ->> 'name'), ''), '');
  meta_nickname text := nullif((new.raw_user_meta_data ->> 'nickname'), '');
  meta_grade text := nullif((new.raw_user_meta_data ->> 'grade'), '');
begin
  if meta_grade is not null and meta_grade not in ('6', '7', '8', '9', '10', '11', '12') then
    meta_grade := null;
  end if;
  insert into public.profiles (id, username, name, nickname, grade)
  values (new.id, meta_username, meta_name, meta_nickname, meta_grade)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Trigger: tự cập nhật updated_at.
-- ---------------------------------------------------------------------
create or replace function public.set_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_profile_updated_at();

-- ---------------------------------------------------------------------
-- 5. Row Level Security: user chỉ được chạm vào ĐÚNG dòng của mình.
--    (Backend dùng SERVICE_ROLE_KEY nên bypass RLS; policy này bảo vệ khi
--    frontend dùng ANON_KEY truy vấn trực tiếp bảng profiles.)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- 6. Bảng user_preferences: lựa chọn Settings (1-1 với auth.users).
--    Chỉ 10 field lựa chọn hiển thị/học tập/AI — KHÔNG chứa
--    name/username/nickname/email/grade/password (đã có endpoint khác).
--    ai_tone: cute (Dễ thương, gần gũi) | honest (Thẳng thắn, thật thà)
--             | funny (Vui vẻ, hài hước) | empathetic (Đồng cảm).
-- ---------------------------------------------------------------------
create table if not exists public.user_preferences (
  id uuid primary key references auth.users (id) on delete cascade,
  avatar text,
  theme text not null default 'light',
  color text not null default 'blue',
  ranking boolean not null default true,
  streak boolean not null default true,
  reminders boolean not null default true,
  reminder_minutes integer not null default 15,
  weekly_hours integer not null default 24,
  sound boolean not null default true,
  ai_tone text not null default 'cute',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_theme_check check (theme in ('light', 'dark')),
  constraint user_preferences_color_check check (color in ('blue', 'violet', 'gold', 'mint')),
  constraint user_preferences_reminder_minutes_check check (reminder_minutes in (0, 5, 10, 15, 30, 60)),
  constraint user_preferences_weekly_hours_check check (weekly_hours between 1 and 70),
  constraint user_preferences_ai_tone_check check (ai_tone in ('cute', 'honest', 'funny', 'empathetic'))
);

-- ---------------------------------------------------------------------
-- 6c. Migration cho DB đã có: thêm cột ai_tone nếu chưa có + backfill.
--     Chạy an toàn nhiều lần (IF NOT EXISTS + chuẩn hóa giá trị lạ về 'cute').
-- ---------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists ai_tone text not null default 'cute';

update public.user_preferences
set ai_tone = 'cute'
where ai_tone is null
   or ai_tone not in ('cute', 'honest', 'funny', 'empathetic');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_preferences_ai_tone_check') then
    alter table public.user_preferences
      add constraint user_preferences_ai_tone_check check (ai_tone in ('cute', 'honest', 'funny', 'empathetic'));
  end if;
end
$$;

drop trigger if exists user_preferences_updated_at on public.user_preferences;
create trigger user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_profile_updated_at();

-- ---------------------------------------------------------------------
-- 6b. Migration: thêm cột user_id (FK tới auth.users) cho user_preferences.
--     DB cũ chỉ có cột `id` (vừa PK vừa FK 1-1). DB mới có thêm `user_id`
--     để đồng nhất với schedule_blocks/deadlines (id riêng + user_id FK).
--     Chạy an toàn nhiều lần: ADD COLUMN IF NOT EXISTS + backfill + unique.
-- ---------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Backfill cho các dòng cũ: user_id = id.
update public.user_preferences
set user_id = id
where user_id is null;

-- Quan hệ 1-1: mỗi user chỉ có 1 dòng preferences.
create unique index if not exists user_preferences_user_id_uidx
  on public.user_preferences (user_id);

create index if not exists user_preferences_user_id_idx
  on public.user_preferences (user_id);

-- Tự đồng bộ user_id = id khi insert/update thiếu user_id
-- (backend mới luôn gửi cả hai; trigger này giữ tương thích backend cũ).
create or replace function public.sync_user_preferences_user_id()
returns trigger language plpgsql as $$
begin
  if new.user_id is null then
    new.user_id := new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists user_preferences_sync_user_id on public.user_preferences;
create trigger user_preferences_sync_user_id
before insert or update on public.user_preferences
for each row execute function public.sync_user_preferences_user_id();

alter table public.user_preferences enable row level security;

drop policy if exists "user_preferences_select_own" on public.user_preferences;
create policy "user_preferences_select_own"
  on public.user_preferences for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "user_preferences_insert_own" on public.user_preferences;
create policy "user_preferences_insert_own"
  on public.user_preferences for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "user_preferences_update_own" on public.user_preferences;
create policy "user_preferences_update_own"
  on public.user_preferences for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "user_preferences_delete_own" on public.user_preferences;
create policy "user_preferences_delete_own"
  on public.user_preferences for delete
  to authenticated
  using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- 7. Bảng schedule_blocks: block học của SchedulePage (1-1..n với auth.users).
--    Mỗi chuỗi lặp lại lưu gọn 1 dòng (kiểu Google Calendar):
--      repeat       : none | daily | weekly | weekdays | weekends | custom | monthly
--      repeat_days  : mảng 0 (CN)..6 (T7), chỉ dùng khi repeat = 'custom'
--      repeat_until : ngày kết thúc, mặc định 31/12 của năm chứa ngày bắt đầu
--      exdates      : các buổi lẻ đã bị xóa/tách khỏi chuỗi (scope=single)
-- ---------------------------------------------------------------------
create table if not exists public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  subject text,
  date date not null,
  start_time time not null,
  end_time time not null,
  tone text not null default 'blue',
  kind text not null default 'study',
  repeat text not null default 'none',
  repeat_days integer[] not null default '{}',
  repeat_until date,
  exdates date[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_blocks_title_length check (char_length(title) between 1 and 160),
  constraint schedule_blocks_time_check check (end_time > start_time),
  constraint schedule_blocks_repeat_check check (repeat in ('none', 'daily', 'weekly', 'weekdays', 'weekends', 'custom', 'monthly')),
  constraint schedule_blocks_kind_check check (kind in ('study', 'deadline')),
  constraint schedule_blocks_repeat_until_check check (
    (repeat = 'none' and repeat_until is null)
    or (repeat <> 'none' and repeat_until is not null and repeat_until >= date)
  ),
  -- Chuỗi lặp lại chỉ chạy trong năm của ngày bắt đầu (hết năm = 31/12).
  constraint schedule_blocks_repeat_within_year_check check (
    repeat_until is null
    or repeat_until <= make_date(extract(year from date)::int, 12, 31)
  )
);

create index if not exists schedule_blocks_user_id_idx
  on public.schedule_blocks (user_id);

create index if not exists schedule_blocks_user_date_idx
  on public.schedule_blocks (user_id, date);

drop trigger if exists schedule_blocks_updated_at on public.schedule_blocks;
create trigger schedule_blocks_updated_at
before update on public.schedule_blocks
for each row execute function public.set_profile_updated_at();

alter table public.schedule_blocks enable row level security;

drop policy if exists "schedule_blocks_select_own" on public.schedule_blocks;
create policy "schedule_blocks_select_own"
  on public.schedule_blocks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "schedule_blocks_insert_own" on public.schedule_blocks;
create policy "schedule_blocks_insert_own"
  on public.schedule_blocks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "schedule_blocks_update_own" on public.schedule_blocks;
create policy "schedule_blocks_update_own"
  on public.schedule_blocks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "schedule_blocks_delete_own" on public.schedule_blocks;
create policy "schedule_blocks_delete_own"
  on public.schedule_blocks for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 8. Bảng deadlines: hạn nộp bài của SchedulePage (1-n với auth.users).
--    Mỗi deadline 1 dòng đơn giản, không lặp lại:
--      title    : tên deadline (1..160 ký tự)
--      due_date : ngày nộp (date)
--      due_time : giờ nộp (time, mặc định 23:59)
--      priority : high | medium | low
--      status   : boolean, false = chưa xong, true = đã hoàn thành
-- ---------------------------------------------------------------------
create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  due_date date not null,
  due_time time not null default '23:59',
  priority text not null default 'medium',
  status boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deadlines_title_length check (char_length(title) between 1 and 160),
  constraint deadlines_priority_check check (priority in ('high', 'medium', 'low'))
);

-- Migration cho DB đã có bảng deadlines nhưng chưa có cột status.
alter table public.deadlines add column if not exists status boolean not null default false;

create index if not exists deadlines_user_id_idx
  on public.deadlines (user_id);

create index if not exists deadlines_user_due_date_idx
  on public.deadlines (user_id, due_date);

drop trigger if exists deadlines_updated_at on public.deadlines;
create trigger deadlines_updated_at
before update on public.deadlines
for each row execute function public.set_profile_updated_at();

alter table public.deadlines enable row level security;

drop policy if exists "deadlines_select_own" on public.deadlines;
create policy "deadlines_select_own"
  on public.deadlines for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "deadlines_insert_own" on public.deadlines;
create policy "deadlines_insert_own"
  on public.deadlines for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "deadlines_update_own" on public.deadlines;
create policy "deadlines_update_own"
  on public.deadlines for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "deadlines_delete_own" on public.deadlines;
create policy "deadlines_delete_own"
  on public.deadlines for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 9. Bảng friendships: quan hệ bạn bè 2 bước (request + accept).
--    - user_id   : người gửi lời mời (FK -> profiles.id = auth.users.id)
--    - friend_id : người nhận lời mời (FK -> profiles.id = auth.users.id)
--    - status    : 'pending' (đã gửi, chờ đồng ý) | 'accepted' (đã là bạn)
--    Frontend thao tác bằng `username` (friend_username); backend tự
--    resolve username -> friend_id nên đổi username không gãy liên kết.
--    Cách chạy: dán toàn bộ file vào SQL Editor > Run (chạy lại an toàn).
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_status_check check (status in ('pending', 'accepted')),
  constraint friendships_no_self_check check (user_id <> friend_id),
  constraint friendships_unique_pair unique (user_id, friend_id)
);

create index if not exists friendships_user_id_idx
  on public.friendships (user_id);

create index if not exists friendships_friend_id_idx
  on public.friendships (friend_id);

create index if not exists friendships_status_idx
  on public.friendships (status);

drop trigger if exists friendships_updated_at on public.friendships;
create trigger friendships_updated_at
before update on public.friendships
for each row execute function public.set_profile_updated_at();

alter table public.friendships enable row level security;

-- User được xem các quan hệ mình tham gia (gửi hoặc nhận).
drop policy if exists "friendships_select_involved" on public.friendships;
create policy "friendships_select_involved"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- Chỉ được gửi lời mời với tư cách chính mình.
drop policy if exists "friendships_insert_own" on public.friendships;
create policy "friendships_insert_own"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Người gửi hoặc người nhận đều được accept (update pending -> accepted).
drop policy if exists "friendships_update_involved" on public.friendships;
create policy "friendships_update_involved"
  on public.friendships for update
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id)
  with check (auth.uid() = user_id or auth.uid() = friend_id);

-- Hai bên đều được hủy / unfriend (xóa dòng mình tham gia).
drop policy if exists "friendships_delete_involved" on public.friendships;
create policy "friendships_delete_involved"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- ---------------------------------------------------------------------
-- 10. Bảng feedbacks: góp ý nhỏ trong trang Trợ giúp (1-n với auth.users).
--     Mỗi góp ý 1 dòng đơn giản, không sửa:
--       message : nội dung góp ý (1..2000 ký tự)
--     Cách chạy: dán toàn bộ file vào SQL Editor > Run (chạy lại an toàn).
-- ---------------------------------------------------------------------
create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedbacks_message_length check (char_length(message) between 1 and 2000)
);

create index if not exists feedbacks_user_id_idx
  on public.feedbacks (user_id);

drop trigger if exists feedbacks_updated_at on public.feedbacks;
create trigger feedbacks_updated_at
before update on public.feedbacks
for each row execute function public.set_profile_updated_at();

alter table public.feedbacks enable row level security;

drop policy if exists "feedbacks_select_own" on public.feedbacks;
create policy "feedbacks_select_own"
  on public.feedbacks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "feedbacks_insert_own" on public.feedbacks;
create policy "feedbacks_insert_own"
  on public.feedbacks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "feedbacks_update_own" on public.feedbacks;
create policy "feedbacks_update_own"
  on public.feedbacks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "feedbacks_delete_own" on public.feedbacks;
create policy "feedbacks_delete_own"
  on public.feedbacks for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 11. Bảng pomodoro_sessions: phiên focus đã hoàn thành (1-n với auth.users).
--     Gọn nhẹ: mỗi phiên 1 dòng —
--       focus_minutes : số phút focus (1..180, timer chạy hết giờ mới ghi)
--       subject       : môn học khóa cứng (khớp backend/subjects.py
--                       POMODORO_SUBJECT_VALUES; NULL = không chọn môn)
--       started_at    : thời điểm bắt đầu (timestamptz)
--       ended_at      : thời điểm kết thúc (timestamptz, > started_at)
--     Không lưu phiên đang chạy / nghỉ / hủy giữa chừng. Không sửa.
--     Cách chạy: dán toàn bộ file vào SQL Editor > Run (chạy lại an toàn).
-- ---------------------------------------------------------------------
create table if not exists public.pomodoro_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  focus_minutes integer not null,
  subject text,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pomodoro_sessions_minutes_check check (focus_minutes between 1 and 180),
  constraint pomodoro_sessions_subject_check check (
    subject is null
    or subject in ('Toán', 'Lí', 'Hoá', 'Văn', 'Sinh', 'Sử', 'Địa', 'Tin', 'Dự án',
                   'Tiếng Anh', 'KHTN', 'GDCD')
  ),
  constraint pomodoro_sessions_time_check check (ended_at > started_at)
);

-- Migration cho DB đã tạo bảng trước khi mở rộng danh mục môn học:
-- đưa các subject tự do cũ về NULL rồi thay constraint cũ bằng constraint mới.
-- (Các môn mới Tiếng Anh/KHTN/GDCD nếu đã chèn tay trước đây được GIỮ lại.)
update public.pomodoro_sessions
set subject = null
where subject is not null
  and subject not in ('Toán', 'Lí', 'Hoá', 'Văn', 'Sinh', 'Sử', 'Địa', 'Tin', 'Dự án',
                      'Tiếng Anh', 'KHTN', 'GDCD');

alter table public.pomodoro_sessions drop constraint if exists pomodoro_sessions_subject_check;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pomodoro_sessions_subject_check') then
    alter table public.pomodoro_sessions
      add constraint pomodoro_sessions_subject_check check (
        subject is null
        or subject in ('Toán', 'Lí', 'Hoá', 'Văn', 'Sinh', 'Sử', 'Địa', 'Tin', 'Dự án',
                       'Tiếng Anh', 'KHTN', 'GDCD')
      );
  end if;
end
$$;

create index if not exists pomodoro_sessions_user_id_idx
  on public.pomodoro_sessions (user_id);

create index if not exists pomodoro_sessions_user_started_idx
  on public.pomodoro_sessions (user_id, started_at);

drop trigger if exists pomodoro_sessions_updated_at on public.pomodoro_sessions;
create trigger pomodoro_sessions_updated_at
before update on public.pomodoro_sessions
for each row execute function public.set_profile_updated_at();

alter table public.pomodoro_sessions enable row level security;

drop policy if exists "pomodoro_sessions_select_own" on public.pomodoro_sessions;
create policy "pomodoro_sessions_select_own"
  on public.pomodoro_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "pomodoro_sessions_insert_own" on public.pomodoro_sessions;
create policy "pomodoro_sessions_insert_own"
  on public.pomodoro_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "pomodoro_sessions_update_own" on public.pomodoro_sessions;
create policy "pomodoro_sessions_update_own"
  on public.pomodoro_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "pomodoro_sessions_delete_own" on public.pomodoro_sessions;
create policy "pomodoro_sessions_delete_own"
  on public.pomodoro_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 12. Bảng goals: mục tiêu cá nhân (1-n với auth.users).
--     Mỗi goal 1 dòng:
--       title        : tên mục tiêu (1..160 ký tự)
--       target_score : điểm mong muốn, NULL = không đặt (0..10)
--       icon         : biểu tượng mục tiêu (emoji, mặc định '🌱')
--       start_date   : ngày bắt đầu (date)
--       end_date     : ngày kết thúc dự kiến (date, >= start_date)
--       status       : 'in_progress' (đang thực hiện) | 'completed' (đã xong)
--       progress     : tiến độ 0..100 (mặc định 0)
--     Cách chạy: dán toàn bộ file vào SQL Editor > Run (chạy lại an toàn).
-- ---------------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  target_score numeric,
  icon text not null default '🌱',
  start_date date not null,
  end_date date not null,
  status text not null default 'in_progress',
  progress integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goals_title_length check (char_length(title) between 1 and 160),
  constraint goals_target_score_check check (target_score is null or (target_score >= 0 and target_score <= 10)),
  constraint goals_icon_length check (char_length(icon) between 1 and 16),
  constraint goals_date_check check (end_date >= start_date),
  constraint goals_status_check check (status in ('in_progress', 'completed')),
  constraint goals_progress_check check (progress between 0 and 100)
);

create index if not exists goals_user_id_idx
  on public.goals (user_id);

create index if not exists goals_user_end_date_idx
  on public.goals (user_id, end_date);

create index if not exists goals_user_status_idx
  on public.goals (user_id, status);

drop trigger if exists goals_updated_at on public.goals;
create trigger goals_updated_at
before update on public.goals
for each row execute function public.set_profile_updated_at();

alter table public.goals enable row level security;

drop policy if exists "goals_select_own" on public.goals;
create policy "goals_select_own"
  on public.goals for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "goals_insert_own" on public.goals;
create policy "goals_insert_own"
  on public.goals for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "goals_update_own" on public.goals;
create policy "goals_update_own"
  on public.goals for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "goals_delete_own" on public.goals;
create policy "goals_delete_own"
  on public.goals for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 13. Bảng ai_sessions + ai_messages: lưu lịch sử chat AI (tiền đề RAG).
--     Router thuần lưu trữ (routers/ai_sessions.py), KHÔNG gọi model AI.
--     - ai_sessions: 1 dòng cho mỗi lần bấm "Tạo đoạn chat mới".
--       title do frontend gửi lên (1..200 ký tự).
--     - ai_messages: 1 dòng cho mỗi lượt user/assistant.
--       role chỉ 'user' | 'assistant', content 1..12000 ký tự.
--       Đọc lại ORDER BY created_at ASC để dựng context RAG.
--       user_id denormalize trên messages để RLS + lọc nhanh theo user.
--     Xóa session CASCADE toàn bộ messages.
--     Cách chạy: dán toàn bộ file vào SQL Editor > Run (chạy lại an toàn).
-- ---------------------------------------------------------------------
create table if not exists public.ai_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_sessions_title_length check (char_length(title) between 1 and 200)
);

create index if not exists ai_sessions_user_id_idx
  on public.ai_sessions (user_id);

create index if not exists ai_sessions_user_updated_idx
  on public.ai_sessions (user_id, updated_at desc);

drop trigger if exists ai_sessions_updated_at on public.ai_sessions;
create trigger ai_sessions_updated_at
before update on public.ai_sessions
for each row execute function public.set_profile_updated_at();

alter table public.ai_sessions enable row level security;

drop policy if exists "ai_sessions_select_own" on public.ai_sessions;
create policy "ai_sessions_select_own"
  on public.ai_sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "ai_sessions_insert_own" on public.ai_sessions;
create policy "ai_sessions_insert_own"
  on public.ai_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "ai_sessions_update_own" on public.ai_sessions;
create policy "ai_sessions_update_own"
  on public.ai_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_sessions_delete_own" on public.ai_sessions;
create policy "ai_sessions_delete_own"
  on public.ai_sessions for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ai_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_messages_role_check check (role in ('user', 'assistant')),
  constraint ai_messages_content_length check (char_length(content) between 1 and 12000)
);

create index if not exists ai_messages_session_id_idx
  on public.ai_messages (session_id);

create index if not exists ai_messages_session_created_idx
  on public.ai_messages (session_id, created_at);

create index if not exists ai_messages_user_id_idx
  on public.ai_messages (user_id);

create index if not exists ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at);

drop trigger if exists ai_messages_updated_at on public.ai_messages;
create trigger ai_messages_updated_at
before update on public.ai_messages
for each row execute function public.set_profile_updated_at();

alter table public.ai_messages enable row level security;

drop policy if exists "ai_messages_select_own" on public.ai_messages;
create policy "ai_messages_select_own"
  on public.ai_messages for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "ai_messages_insert_own" on public.ai_messages;
create policy "ai_messages_insert_own"
  on public.ai_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "ai_messages_update_own" on public.ai_messages;
create policy "ai_messages_update_own"
  on public.ai_messages for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "ai_messages_delete_own" on public.ai_messages;
create policy "ai_messages_delete_own"
  on public.ai_messages for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 14. Lộ trình học (RoadmapPage.jsx): 3 bảng chuẩn — roadmaps + stages + lessons.
--     - roadmaps: 1 dòng cho mỗi lộ trình (scalar từ draft: title, subject,
--       start/end_date, start_time + duration, sessions_per_week, study_days,
--       context, notes, grade, level, scores, weak_topics, learning_style,
--       goal_id FK goals SET NULL, ai_generated).
--     - roadmap_stages: chặng AI (title, goal, materials JSONB [{label,url}] max 3,
--       checkpoint, position giữ thứ tự). Lộ trình cơ bản không có stage rows —
--       frontend rơi về 4 chặng mặc định.
--     - roadmap_lessons: buổi học (title, focus, date, start/end_time,
--       material_url/label, done, stage_index để xếp vào chặng hiển thị,
--       stage_id nullable để join khi có stages).
--     user_id denormalize trên cả 3 bảng để RLS đơn giản (auth.uid()=user_id)
--     mà không cần join. Xóa roadmap CASCADE stages + lessons.
--     Cách chạy: dán toàn bộ file vào SQL Editor > Run (chạy lại an toàn).
-- ---------------------------------------------------------------------
create table if not exists public.roadmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid references public.goals (id) on delete set null,
  title text not null,
  subject text not null,
  start_date date not null,
  end_date date not null,
  start_time time not null default '19:00',
  duration_minutes integer not null default 60,
  sessions_per_week integer not null default 5,
  study_days integer[] not null default '{}',
  context text not null default '',
  notes text not null default '',
  grade text,
  level text not null default '',
  current_score numeric,
  target_score numeric,
  weak_topics text not null default '',
  learning_style text not null default '',
  ai_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmaps_title_length check (char_length(title) between 1 and 160),
  constraint roadmaps_subject_length check (char_length(subject) between 1 and 80),
  constraint roadmaps_date_check check (end_date >= start_date),
  constraint roadmaps_duration_check check (duration_minutes between 5 and 240),
  constraint roadmaps_sessions_check check (sessions_per_week between 1 and 7),
  constraint roadmaps_context_length check (char_length(context) between 1 and 2000),
  constraint roadmaps_notes_length check (char_length(notes) <= 2000),
  constraint roadmaps_grade_check check (grade is null or grade in ('6', '7', '8', '9', '10', '11', '12')),
  constraint roadmaps_level_check check (level in ('', 'foundation', 'basic', 'confident', 'advanced')),
  constraint roadmaps_current_score_check check (current_score is null or (current_score >= 0 and current_score <= 10)),
  constraint roadmaps_target_score_check check (target_score is null or (target_score >= 0 and target_score <= 10)),
  constraint roadmaps_weak_topics_length check (char_length(weak_topics) <= 600),
  constraint roadmaps_learning_style_length check (char_length(learning_style) <= 300)
);

create index if not exists roadmaps_user_id_idx
  on public.roadmaps (user_id);

create index if not exists roadmaps_user_created_idx
  on public.roadmaps (user_id, created_at desc);

create index if not exists roadmaps_goal_id_idx
  on public.roadmaps (goal_id);

drop trigger if exists roadmaps_updated_at on public.roadmaps;
create trigger roadmaps_updated_at
before update on public.roadmaps
for each row execute function public.set_profile_updated_at();

alter table public.roadmaps enable row level security;

drop policy if exists "roadmaps_select_own" on public.roadmaps;
create policy "roadmaps_select_own"
  on public.roadmaps for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "roadmaps_insert_own" on public.roadmaps;
create policy "roadmaps_insert_own"
  on public.roadmaps for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "roadmaps_update_own" on public.roadmaps;
create policy "roadmaps_update_own"
  on public.roadmaps for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "roadmaps_delete_own" on public.roadmaps;
create policy "roadmaps_delete_own"
  on public.roadmaps for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.roadmap_stages (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references public.roadmaps (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null default 0,
  title text not null,
  goal text not null default '',
  materials jsonb not null default '[]',
  checkpoint text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmap_stages_title_length check (char_length(title) between 1 and 160),
  constraint roadmap_stages_goal_length check (char_length(goal) <= 800),
  constraint roadmap_stages_checkpoint_length check (char_length(checkpoint) <= 800),
  constraint roadmap_stages_position_check check (position >= 0),
  constraint roadmap_stages_unique_position unique (roadmap_id, position)
);

create index if not exists roadmap_stages_roadmap_id_idx
  on public.roadmap_stages (roadmap_id);

create index if not exists roadmap_stages_user_id_idx
  on public.roadmap_stages (user_id);

drop trigger if exists roadmap_stages_updated_at on public.roadmap_stages;
create trigger roadmap_stages_updated_at
before update on public.roadmap_stages
for each row execute function public.set_profile_updated_at();

alter table public.roadmap_stages enable row level security;

drop policy if exists "roadmap_stages_select_own" on public.roadmap_stages;
create policy "roadmap_stages_select_own"
  on public.roadmap_stages for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "roadmap_stages_insert_own" on public.roadmap_stages;
create policy "roadmap_stages_insert_own"
  on public.roadmap_stages for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "roadmap_stages_update_own" on public.roadmap_stages;
create policy "roadmap_stages_update_own"
  on public.roadmap_stages for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "roadmap_stages_delete_own" on public.roadmap_stages;
create policy "roadmap_stages_delete_own"
  on public.roadmap_stages for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.roadmap_lessons (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references public.roadmaps (id) on delete cascade,
  stage_id uuid references public.roadmap_stages (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage_index integer not null default 0,
  title text not null,
  focus text not null default '',
  date date not null,
  start_time time not null,
  end_time time not null,
  material_url text not null default '',
  material_label text not null default '',
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmap_lessons_title_length check (char_length(title) between 1 and 160),
  constraint roadmap_lessons_focus_length check (char_length(focus) <= 600),
  constraint roadmap_lessons_time_check check (end_time > start_time),
  constraint roadmap_lessons_stage_index_check check (stage_index >= 0),
  constraint roadmap_lessons_material_url_length check (char_length(material_url) <= 2000),
  constraint roadmap_lessons_material_label_length check (char_length(material_label) <= 200)
);

create index if not exists roadmap_lessons_roadmap_id_idx
  on public.roadmap_lessons (roadmap_id);

create index if not exists roadmap_lessons_stage_id_idx
  on public.roadmap_lessons (stage_id);

create index if not exists roadmap_lessons_user_date_idx
  on public.roadmap_lessons (user_id, date);

drop trigger if exists roadmap_lessons_updated_at on public.roadmap_lessons;
create trigger roadmap_lessons_updated_at
before update on public.roadmap_lessons
for each row execute function public.set_profile_updated_at();

alter table public.roadmap_lessons enable row level security;

drop policy if exists "roadmap_lessons_select_own" on public.roadmap_lessons;
create policy "roadmap_lessons_select_own"
  on public.roadmap_lessons for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "roadmap_lessons_insert_own" on public.roadmap_lessons;
create policy "roadmap_lessons_insert_own"
  on public.roadmap_lessons for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "roadmap_lessons_update_own" on public.roadmap_lessons;
create policy "roadmap_lessons_update_own"
  on public.roadmap_lessons for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "roadmap_lessons_delete_own" on public.roadmap_lessons;
create policy "roadmap_lessons_delete_own"
  on public.roadmap_lessons for delete
  to authenticated
  using (auth.uid() = user_id);
