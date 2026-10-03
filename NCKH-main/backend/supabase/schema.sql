create extension if not exists pgcrypto;

create table if not exists public.profile (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_username_format check (username ~ '^[a-z0-9_.-]{3,64}$'),
  constraint profile_name_length check (char_length(name) between 1 and 120)
);

create unique index if not exists profile_username_lower_idx
  on public.profile (lower(username));

create or replace function public.set_profile_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profile_updated_at on public.profile;
create trigger profile_updated_at
before update on public.profile
for each row execute function public.set_profile_updated_at();

alter table public.profile enable row level security;
