-- ============================================================
-- 004: 스토리지 읽기 정책을 definer 함수 기반으로 재작성
-- 증상: 파일이 존재하고 선생님이 학생 프로필도 읽을 수 있는데
--       storage.objects 다운로드만 "Object not found"(RLS 거부).
-- 앱은 /api/strokes 폴백으로 이미 동작하지만, 정책도 바로잡아 둔다.
-- 실행: SQL Editor 에 전체 붙여넣기 (⚠️ 아무것도 선택하지 않은 상태로 Run)
-- ============================================================

create or replace function public.sp_can_read_strokes(object_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (storage.foldername(object_name))[1] = auth.uid()::text
    or exists (
      select 1 from public.sp_profiles p
      where p.id::text = (storage.foldername(object_name))[1]
        and p.teacher_id = auth.uid()
    )
    or (select role from public.sp_profiles where id = auth.uid()) = 'admin'
$$;

drop policy if exists sp_strokes_read on storage.objects;
create policy sp_strokes_read on storage.objects for select using (
  bucket_id = 'sp-strokes' and public.sp_can_read_strokes(name)
);

-- 잔여 정리: 진단용 테이블 제거
drop table if exists public.sp_debug;
