-- 011: 펜 영구 번호
-- 펜 관리 [펜 연결] 등록 시 입력한 번호를 저장해, 이후 어디서든 "펜 N"으로 표시.
-- (적용 전에는 클라이언트가 로컬 폴백으로 동작하지만, 기기 간 공유를 위해 적용 권장)
alter table public.sp_pens add column if not exists pen_number int;
