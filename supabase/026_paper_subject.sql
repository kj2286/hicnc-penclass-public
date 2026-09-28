-- ============================================================
-- 026 — 교재 과목 (수학·국어·영어, 2026-09-04)
--
-- 문항 인식 프롬프트가 "이 이미지는 수학 교재의 한 페이지입니다" 로 고정돼
-- 있어, 국어·영어 시험지를 넣으면 모델이 지시대로 {"problems":[]} 를 돌려주고
-- 문항이 하나도 안 잡혔다(사용자 신고 2026-09-04). 업로드할 때 과목을 받아
-- 인식·채점·분석 프롬프트를 그 과목으로 돌린다.
--
-- null = 과목 미지정. 기존 교재는 전부 수학이라 코드가 null 을 수학으로 읽는다.
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists subject text;

-- 값은 앱이 강제하지만, 오타가 들어오면 인식 프롬프트가 통째로 어긋나므로
-- DB 에서도 막는다. 기존 행(null)은 그대로 통과한다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sp_paper_owners_subject_chk'
  ) then
    alter table public.sp_paper_owners
      add constraint sp_paper_owners_subject_chk
      check (subject is null or subject in ('수학', '국어', '영어'));
  end if;
end $$;
