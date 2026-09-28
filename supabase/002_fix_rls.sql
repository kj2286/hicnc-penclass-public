-- ============================================================
-- 002: sp_profiles RLS 무한재귀 수정 (42P17)
-- 원인: sp_profiles_select 정책 안에서 sp_profiles 를 인라인 서브쿼리로
--       다시 조회 → 같은 정책이 재적용되며 재귀.
-- 해결: SECURITY DEFINER 헬퍼 함수(RLS 우회)로 교체. (idempotent)
-- ============================================================

create or replace function public.sp_my_teacher_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select teacher_id from public.sp_profiles where id = auth.uid()
$$;

drop policy if exists sp_profiles_select on public.sp_profiles;
create policy sp_profiles_select on public.sp_profiles for select using (
  id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  -- 학생이 자기 담당 선생님 프로필(이름)을 읽을 수 있게 (definer 함수라 재귀 없음)
  or id = public.sp_my_teacher_id()
);

-- 제출 insert 정책도 같은 헬퍼로 교체 (동작 동일, 표현만 안전하게)
drop policy if exists sp_submissions_student_insert on public.sp_submissions;
create policy sp_submissions_student_insert on public.sp_submissions for insert with check (
  student_id = auth.uid()
  and teacher_id = public.sp_my_teacher_id()
);
