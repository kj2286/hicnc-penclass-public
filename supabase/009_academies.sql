-- ============================================================
-- 009 — 학원(Academy) 구조
-- 관리자 > 학원 관리: 학원 안에 선생님이 소속되고, 학원별로
-- 선생님 수·학원생 수·펜 수를 집계한다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- ============================================================

create table if not exists public.sp_academies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  memo text,
  created_at timestamptz not null default now()
);

-- 선생님 프로필에 소속 학원. 학생의 학원은 담당 선생님을 통해 파생된다.
alter table public.sp_profiles
  add column if not exists academy_id uuid references public.sp_academies(id) on delete set null;

create index if not exists sp_profiles_academy_idx on public.sp_profiles (academy_id);

alter table public.sp_academies enable row level security;

-- 조회: 로그인 사용자 전체 (선생님/학생 화면에서 소속 학원명 표시용)
drop policy if exists sp_academies_select on public.sp_academies;
create policy sp_academies_select on public.sp_academies for select using (
  auth.uid() is not null
);

-- 생성/수정/삭제: 관리자 전용
drop policy if exists sp_academies_admin_write on public.sp_academies;
create policy sp_academies_admin_write on public.sp_academies for all using (
  public.sp_role() = 'admin'
) with check (
  public.sp_role() = 'admin'
);
