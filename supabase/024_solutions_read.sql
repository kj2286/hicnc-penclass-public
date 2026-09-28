-- 024: 모범 풀이·답안(solutions/) 읽기 허용 — 교사·관리자 (2026-09-02)
--
-- 배경: solutions/{pdfId}.json·p{n}.png 는 서비스키로 올라갔지만, 교사 웹의
-- 읽기는 sp_strokes_read 정책(첫 폴더 = 학생 uuid 만 허용)에 막혀
-- 모범 풀이 비교가 전혀 동작하지 않았다 (박초이 6-2b형 사례로 확인).
-- 기존 정책은 첫 폴더가 uuid 가 아니면 ::uuid 캐스트에서 에러가 나는 문제도
-- 있었다 — CASE 로 캐스트 전에 형태를 검사한다 (CASE 는 평가 순서가 보장된다).
drop policy if exists sp_strokes_read on storage.objects;
create policy sp_strokes_read on storage.objects for select using (
  bucket_id = 'sp-strokes'
  and (
    case
      -- 모범 풀이·답안 — 교사·관리자 공용 읽기 (학생 클라이언트는 쓰지 않는다)
      when (storage.foldername(name))[1] = 'solutions'
        then public.sp_role() in ('teacher', 'admin')
      -- 학생 폴더 — 본인 / 담당(공동 담당 포함) / 관리자
      when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (
          (storage.foldername(name))[1] = auth.uid()::text
          or public.sp_is_my_student(((storage.foldername(name))[1])::uuid)
          or public.sp_role() = 'admin'
        )
      else public.sp_role() = 'admin'
    end
  )
);
