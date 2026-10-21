-- JD Resume Tailor: run this once in Supabase > SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  mobile text not null unique,
  password_hash text not null,
  ai jsonb not null default '{}'::jsonb,          -- AI provider settings; API keys are encrypted by the app
  session_version int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.applications (
  id text primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb,
  data jsonb not null
);
create index if not exists applications_user_created on public.applications (user_id, created_at desc);

-- Only the app server (service role key) may read or write. No public access.
alter table public.users enable row level security;
alter table public.applications enable row level security;

-- Private bucket for interview recordings (50 MB per file).
insert into storage.buckets (id, name, public, file_size_limit)
values ('audio', 'audio', false, 52428800)
on conflict (id) do nothing;
