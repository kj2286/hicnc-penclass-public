-- 012: 교재(ncode PDF) 소유 매핑
-- NGS 는 선생님 개념이 없는 공용 서버라, 어떤 선생님이 올린 교재인지 여기 기록한다.
-- 교재 만들기 목록은 내 소유(pdf_id)만 노출. (적용 전에는 기존처럼 전체 노출 폴백)
create table if not exists public.sp_paper_owners (
  pdf_id int primary key,
  teacher_id uuid not null references public.sp_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.sp_paper_owners enable row level security;

drop policy if exists sp_paper_owners_teacher_all on public.sp_paper_owners;
create policy sp_paper_owners_teacher_all on public.sp_paper_owners
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());
