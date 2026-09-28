-- 019: 도입 신청서에 이메일 추가
--
-- 전화번호를 잘못 적으면 그 신청은 되물을 방법이 없어 통째로 죽는다.
-- 연락 경로를 둘로 두어 하나가 틀려도 닿을 수 있게 한다(사용자 요구 2026-08-17).

alter table public.sp_academy_applications
  add column if not exists contact_email text;
