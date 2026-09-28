-- ============================================================
-- 022 — 교재의 특수 페이지 지정 (표지 본인정보 / 별도 정답지)
--
-- 업로드 시 선생님이 지정: 표지 본인정보 기입란 페이지, 정답지 페이지.
-- 필기 기록 화면이 본인정보 대조·정답지 기준 채점에 사용한다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists info_page int,
  add column if not exists answer_page int;
