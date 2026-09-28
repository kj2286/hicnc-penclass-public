-- 025: 모범 풀이·답안(solutions/) 쓰기 — 교사·관리자 (2026-09-02)
--
-- 배경: 문제지 상세에 "풀이+답안 PDF 올리기" 기능이 생겼다. 교사 웹이
-- solutions/{pdfId}.json 과 solutions/{pdfId}/p{n}.png 를 직접 올리므로
-- insert/update/delete 정책이 필요하다 (읽기는 024 에서 열었다).
drop policy if exists sp_strokes_solutions_write on storage.objects;
create policy sp_strokes_solutions_write on storage.objects for insert with check (
  bucket_id = 'sp-strokes'
  and (storage.foldername(name))[1] = 'solutions'
  and public.sp_role() in ('teacher', 'admin')
);

drop policy if exists sp_strokes_solutions_update on storage.objects;
create policy sp_strokes_solutions_update on storage.objects for update using (
  bucket_id = 'sp-strokes'
  and (storage.foldername(name))[1] = 'solutions'
  and public.sp_role() in ('teacher', 'admin')
) with check (
  bucket_id = 'sp-strokes'
  and (storage.foldername(name))[1] = 'solutions'
  and public.sp_role() in ('teacher', 'admin')
);

drop policy if exists sp_strokes_solutions_delete on storage.objects;
create policy sp_strokes_solutions_delete on storage.objects for delete using (
  bucket_id = 'sp-strokes'
  and (storage.foldername(name))[1] = 'solutions'
  and public.sp_role() in ('teacher', 'admin')
);
