-- ============================================================
-- 008 — 학생 프로필 확장 (학생 관리 리스트뷰/추가 팝업 개편)
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
--
-- 필수 입력: 이름(기존 name) + 학년(school_level 초/중/고 + grade 숫자)
-- 선택 입력: 학생/학부모 연락처·학교·수업 시작일·집주소·특이사항·펜 보유
-- 퇴원 상태는 기존 deleted_at(006) 을 그대로 사용한다 (재원=null).
-- ============================================================

alter table public.sp_profiles
  add column if not exists school_level text
    check (school_level is null or school_level in ('초', '중', '고')),
  add column if not exists grade int
    check (grade is null or (grade >= 1 and grade <= 6)),
  add column if not exists student_phone text,
  add column if not exists parent_phone text,
  add column if not exists school text,
  add column if not exists start_date date,
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists has_pen boolean not null default false;
