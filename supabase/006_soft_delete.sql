-- ============================================================
-- 006 — 학생 소프트 삭제(휴지통) 지원
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
--
-- deleted_at 이 null 이면 재원, 값이 있으면 휴지통(임시보관) 상태.
-- 삭제/복구/영구삭제는 서버리스(api/student-trash.ts, 서비스키)가 수행하므로
-- RLS 정책 변경은 없습니다. 영구삭제는 auth.users 삭제 → FK cascade 로
-- 프로필·제출·피드백이 함께 지워집니다.
-- ============================================================

alter table public.sp_profiles
  add column if not exists deleted_at timestamptz;

-- 재원 학생 목록 조회 최적화 (휴지통 제외 스캔)
create index if not exists sp_profiles_teacher_active_idx
  on public.sp_profiles (teacher_id)
  where deleted_at is null;
