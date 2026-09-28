-- ============================================================
-- 021 — 교재·문항별 AI 프롬프트 (학원 개별 설정, 2026-08-22)
--
-- 학원마다 학생 평가 방식이 달라, 운영사 공통 프롬프트에 더해
-- 학원이 교재 전체/문항별 추가 지시문을 정의할 수 있게 한다.
-- 토글(OFF)이면 기존 공통(수학비서) 프롬프트만 사용 — 완전 하위호환.
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

-- 학원 설정 토글 — 대표자만 학원 설정에서 켠다 (기본 OFF)
alter table public.sp_academies
  add column if not exists custom_prompts_enabled boolean not null default false;

-- 교재·문항별 프롬프트
create table if not exists public.sp_paper_prompts (
  academy_id uuid not null references public.sp_academies(id) on delete cascade,
  pdf_id int not null,
  -- 'paper' = 교재 전체, 'q{번호}' = 문항별 (예: q3)
  scope text not null,
  prompt text not null,
  updated_at timestamptz not null default now(),
  primary key (academy_id, pdf_id, scope)
);

alter table public.sp_paper_prompts enable row level security;

-- 같은 학원 선생님은 읽고 쓸 수 있다 (토글 자체는 학원 설정=대표자 관리)
drop policy if exists sp_paper_prompts_academy_rw on public.sp_paper_prompts;
create policy sp_paper_prompts_academy_rw on public.sp_paper_prompts
  for all using (
    academy_id = (select academy_id from public.sp_profiles where id = auth.uid())
  ) with check (
    academy_id = (select academy_id from public.sp_profiles where id = auth.uid())
  );
