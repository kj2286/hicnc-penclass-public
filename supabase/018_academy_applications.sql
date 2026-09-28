-- 018: 학원 도입 신청 접수 (펜클래스 랜딩페이지 → 슈퍼관리자)
--
-- 구조 결정(2026-08-17):
--   · **관리자는 웹에서 총괄**한다 — 신청 접수·학원 개설·홈페이지 배포 전부 웹.
--   · **학원은 PC 프로그램에서 로그인**해 쓴다.
--   그래서 신청서는 로그인 없이(anon) 넣을 수 있어야 하고,
--   읽기·상태 변경은 슈퍼관리자만 할 수 있어야 한다.

create table if not exists public.sp_academy_applications (
  id uuid primary key default gen_random_uuid(),
  academy_name text not null,
  location text not null,
  student_count int,
  teacher_count int,
  contact_name text,
  contact_phone text not null,
  memo text,
  -- new(접수) → contacted(연락함) → done(개설 완료) / rejected(보류)
  status text not null default 'new'
    check (status in ('new', 'contacted', 'done', 'rejected')),
  /** 관리자 메모 — 통화 내용 등 */
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sp_academy_applications_created_idx
  on public.sp_academy_applications (created_at desc);

alter table public.sp_academy_applications enable row level security;

-- 접수: 로그인 없이 누구나 넣을 수 있다 (랜딩페이지 폼).
-- 넣기만 가능하고 조회는 불가 — 남의 신청서를 볼 수 없어야 한다.
drop policy if exists sp_apps_public_insert on public.sp_academy_applications;
create policy sp_apps_public_insert on public.sp_academy_applications
  for insert to anon, authenticated with check (true);

-- 조회·수정·삭제: 슈퍼관리자만.
drop policy if exists sp_apps_admin_all on public.sp_academy_applications;
create policy sp_apps_admin_all on public.sp_academy_applications
  for all using (
    exists (
      select 1 from public.sp_profiles
      where id = auth.uid() and role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.sp_profiles
      where id = auth.uid() and role = 'admin'
    )
  );
