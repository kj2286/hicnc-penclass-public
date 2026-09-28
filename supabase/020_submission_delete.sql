-- 020: 선생님이 학생 필기 기록(제출)을 삭제할 수 있게 한다 (2026-08-17 사용자 요구)
--
-- 지금까지 sp_submissions 에는 insert/select/update 정책만 있고 delete 가 없어서
-- 클라이언트 삭제가 **소리 없이 0행**으로 끝난다(RLS 는 오류를 내지 않는다).
-- 피드백(sp_feedback)은 FK on delete cascade 라 제출을 지우면 함께 지워진다.

-- 제출 행 삭제: 담당 선생님 본인 것만
drop policy if exists sp_submissions_teacher_delete on public.sp_submissions;
create policy sp_submissions_teacher_delete on public.sp_submissions for delete using (
  teacher_id = auth.uid()
);

-- 스토리지: 필기(.json.gz)·썸네일(.png) 원본도 지울 수 있어야 한다.
-- 경로 규칙은 {student_id}/{submission_id}.* — 담당 학생 폴더만 허용.
drop policy if exists sp_strokes_teacher_delete on storage.objects;
create policy sp_strokes_teacher_delete on storage.objects for delete using (
  bucket_id = 'sp-strokes'
  and public.sp_is_my_student(((storage.foldername(name))[1])::uuid)
);
