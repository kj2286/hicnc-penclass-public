-- ============================================================
-- 028 — 교재 과목에 **과학** 추가 (2026-09-04)
--
-- 026 이 subject 를 ('수학','국어','영어') 로 못박아 두어서, 과목을 과학으로
-- 지정하면 CHECK 제약(sp_paper_owners_subject_chk)에 걸려 저장이 실패한다.
-- 앱은 이미 수학·영어·국어·과학 넷을 다루므로 제약을 다시 만들어 맞춘다.
--
-- 제약을 drop 한 뒤 재생성한다 — 여러 번 실행해도 결과가 같다(idempotent).
-- 기존 행(null 포함)은 그대로 통과한다.
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요.
-- https://supabase.com/dashboard
-- ============================================================

-- 026 을 건너뛴 DB 에서도 그대로 돌도록 컬럼부터 보장한다.
alter table public.sp_paper_owners
  add column if not exists subject text;

alter table public.sp_paper_owners
  drop constraint if exists sp_paper_owners_subject_chk;

alter table public.sp_paper_owners
  add constraint sp_paper_owners_subject_chk
  check (subject is null or subject in ('수학', '국어', '영어', '과학'));
