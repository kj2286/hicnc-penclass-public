-- 013: 교재 휴지통
-- 교재 만들기에서 삭제하면 즉시 지우지 않고 휴지통(deleted_at)으로 이동.
-- 삭제 내역에서 원복(deleted_at=null) 또는 영구 삭제(NGS soft-delete + 행 삭제).
alter table public.sp_paper_owners add column if not exists deleted_at timestamptz;
