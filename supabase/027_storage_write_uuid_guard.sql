-- ============================================================
-- 027 — 스토리지 쓰기 정책의 uuid 캐스트 방어 (2026-09-04)
--
-- 실사고: 선생님이 교재 만들기에서 풀이+답안을 올리면 저장 단계에서
--   invalid input syntax for type uuid: "solutions"
-- 로 매번 실패했다. 025 가 solutions/ 쓰기 정책을 **추가**했지만, 010·020 의
-- 학생 폴더용 쓰기·갱신·삭제 정책이 첫 폴더명을 무조건 ::uuid 로 캐스팅한다.
-- Postgres 는 같은 동작의 permissive 정책을 전부 평가하므로, 그중 하나가
-- 캐스트에서 터지면 문장 전체가 에러다. 024 가 읽기(SELECT)에서 잡은 것과
-- 정확히 같은 함정을 쓰기에서 못 잡은 것.
--
-- 고침: uuid 모양인지 먼저 보고 그때만 캐스트하는 헬퍼로 세 정책을 다시 만든다.
-- (CASE 는 평가 순서가 보장되어 캐스트 전에 정규식 검사가 끝난다.)
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

-- 첫 폴더가 담당 학생의 uuid 인가 — uuid 모양이 아니면 캐스트 없이 false.
create or replace function public.sp_is_my_student_folder(object_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when (storage.foldername(object_name))[1]
         ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.sp_is_my_student(((storage.foldername(object_name))[1])::uuid)
    else false
  end
$$;

-- 010: 선생님이 담당 학생 폴더에 업로드·갱신
drop policy if exists sp_strokes_teacher_write on storage.objects;
create policy sp_strokes_teacher_write on storage.objects for insert with check (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student_folder(name)
);

drop policy if exists sp_strokes_teacher_update on storage.objects;
create policy sp_strokes_teacher_update on storage.objects for update using (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student_folder(name)
) with check (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student_folder(name)
);

-- 020: 선생님이 담당 학생 제출 삭제
drop policy if exists sp_strokes_teacher_delete on storage.objects;
create policy sp_strokes_teacher_delete on storage.objects for delete using (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student_folder(name)
);

-- 025 의 sp_strokes_solutions_write / _update / _delete 는 그대로 둔다 —
-- 이제 옛 정책이 터지지 않으니 그 정책들이 제대로 solutions/ 쓰기를 허용한다.
