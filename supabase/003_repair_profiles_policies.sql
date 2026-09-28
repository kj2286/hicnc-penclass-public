-- ============================================================
-- 003: sp_profiles 정책 전면 수리 (42P17 잔존 대응)
-- ① 현재 정책을 sp_debug 에 기록(원격 진단용) → ② 이름 불문 전부 삭제
-- → ③ 재귀 없는 정책으로 재생성 → ④ 결과도 sp_debug 에 기록. (idempotent)
-- ============================================================

create table if not exists public.sp_debug (
  at timestamptz default now(),
  phase text,
  policyname text,
  cmd text,
  qual text,
  with_check text
);
truncate public.sp_debug;

insert into public.sp_debug (phase, policyname, cmd, qual, with_check)
select 'before', policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'sp_profiles';

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'sp_profiles'
  loop
    execute format('drop policy %I on public.sp_profiles', pol.policyname);
  end loop;
end $$;

-- 재생성 (인라인 서브쿼리 금지 — definer 함수만 사용)
create policy sp_profiles_select on public.sp_profiles for select using (
  id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  or id = public.sp_my_teacher_id()
);

create policy sp_profiles_update_self on public.sp_profiles for update using (
  id = auth.uid() or public.sp_role() = 'admin'
);

insert into public.sp_debug (phase, policyname, cmd, qual, with_check)
select 'after', policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'sp_profiles';
