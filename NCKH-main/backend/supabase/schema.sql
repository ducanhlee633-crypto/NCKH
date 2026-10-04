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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_.-]{3,64}$'),
  constraint profiles_name_length check (char_length(name) between 0 and 120)
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username)) where username is not null;

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
--    Lấy username/name từ raw_user_meta_data do backend gửi lên.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_username text := nullif((new.raw_user_meta_data ->> 'username'), '');
  meta_name text := coalesce(nullif((new.raw_user_meta_data ->> 'name'), ''), '');
begin
  insert into public.profiles (id, username, name)
  values (new.id, meta_username, meta_name)
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
