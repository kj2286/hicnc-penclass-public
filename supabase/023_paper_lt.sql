-- ============================================================
-- 023 — 테스트지의 LT 종류 (초등LT / 중등LT)
--
-- 업로드에서 종류를 '테스트지' 로 고르면 LT 종류를 함께 고른다.
-- 리뷰 화면이 이 값으로 "이 교재에 있어야 할 단계" 를 알고 필기 기록과 대조한다.
--   초등LT = 계산식 · 1단계 · 2단계 · 3단계
--   중등LT = 1단계 · 2단계 · 3단계
-- 단계 구성만 고정이고 **문항 수는 교재마다 다르다** — 칼럼으로 두지 않는다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists lt_type text
  check (lt_type is null or lt_type in ('초등LT', '중등LT'));
