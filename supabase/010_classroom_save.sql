-- ============================================================
-- 010 — 교실 모드 자동 저장
-- 선생님이 교실 모드(직접 연결)에서 담당 학생의 필기를 대신 저장할 수
-- 있도록 RLS 를 연다. (제출 insert + sp-strokes 스토리지 쓰기/갱신)
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- ============================================================

-- 담당 학생 여부 (definer — sp_profiles RLS 재귀 없이 판정)
create or replace function public.sp_is_my_student(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.sp_profiles p
    where p.id = sid and p.teacher_id = auth.uid()
  );
$$;

-- 선생님이 담당 학생 명의의 제출(교실 자동 저장)을 생성
drop policy if exists sp_submissions_teacher_insert on public.sp_submissions;
create policy sp_submissions_teacher_insert on public.sp_submissions for insert with check (
  teacher_id = auth.uid() and public.sp_is_my_student(student_id)
);

-- 스토리지: 선생님이 담당 학생 폴더({student_id}/...)에 필기/썸네일 업로드·갱신
drop policy if exists sp_strokes_teacher_write on storage.objects;
create policy sp_strokes_teacher_write on storage.objects for insert with check (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student(((storage.foldername(name))[1])::uuid)
);

drop policy if exists sp_strokes_teacher_update on storage.objects;
create policy sp_strokes_teacher_update on storage.objects for update using (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student(((storage.foldername(name))[1])::uuid)
) with check (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student(((storage.foldername(name))[1])::uuid)
);
