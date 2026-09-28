-- 017: 학원 전용 홈페이지 — 주소(slug) + 게시 메타 + 정적 파일 버킷
--
-- 배경: 학원이 펜클래스에 가입하면 학원 전용 홈페이지 주소를 준다.
--   · 주소는 경로 방식 — /h/{slug}
--   · 홈페이지 파일(ZIP)은 슈퍼관리자가 올린다. 학원은 못 올린다.
--   · 원장·선생님은 그 홈페이지의 [로그인] 버튼으로 우리 로그인 화면에 온다.
--
-- ⚠️ 서버리스 함수는 이미 12개(Vercel Hobby 한도)라 새로 못 만든다.
--    업로드는 관리자 브라우저에서 Storage 로 직접, 서빙은 Storage 공개 URL 로 한다.

-- ---------- 1) 학원 주소(slug) ----------
alter table public.sp_academies
  add column if not exists slug text,
  -- 홈페이지를 마지막으로 올린 시각·올린 사람 (관리자 화면 표시용)
  add column if not exists site_published_at timestamptz,
  add column if not exists site_published_by uuid references public.sp_profiles(id) on delete set null,
  -- 올린 원본 ZIP 파일명 — "무엇을 올렸는지" 를 나중에 알아볼 수 있게
  add column if not exists site_source_name text;

-- slug 는 주소가 되므로 전역 유일해야 한다. 아직 안 정한 학원(null)은 여러 개 허용.
create unique index if not exists sp_academies_slug_key
  on public.sp_academies (slug)
  where slug is not null;

-- ---------- 2) 정적 파일 버킷 ----------
-- 홈페이지는 로그인 없이 보여야 하므로 공개 버킷.
-- (업로드 권한은 아래 정책에서 admin 으로 잠근다 — 공개는 읽기뿐이다.)
insert into storage.buckets (id, name, public)
values ('academy-sites', 'academy-sites', true)
on conflict (id) do update set public = true;

-- ---------- 3) 버킷 정책 ----------
-- 읽기: 누구나 (학원 홈페이지는 방문자에게 열려 있어야 한다)
drop policy if exists academy_sites_public_read on storage.objects;
create policy academy_sites_public_read on storage.objects
  for select using (bucket_id = 'academy-sites');

-- 쓰기·삭제: 슈퍼관리자만. 학원 대표자도 못 올린다(사용자 결정 — 파일은 우리가 만든다).
drop policy if exists academy_sites_admin_write on storage.objects;
create policy academy_sites_admin_write on storage.objects
  for all using (
    bucket_id = 'academy-sites'
    and exists (
      select 1 from public.sp_profiles
      where id = auth.uid() and role = 'admin'
    )
  ) with check (
    bucket_id = 'academy-sites'
    and exists (
      select 1 from public.sp_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- ---------- 4) 홈페이지 조회용 공개 읽기 ----------
-- /h/{slug} 는 로그인 전에 열리므로, slug 로 학원을 찾을 수 있어야 한다.
-- 홈페이지 표시에 필요한 최소 정보만 담은 뷰를 열어준다 (학생·선생님 정보 아님).
create or replace view public.sp_academy_sites
with (security_invoker = off) as
  select id, name, slug, logo_text, logo_image_url, theme_color, site_published_at
  from public.sp_academies
  where slug is not null and site_published_at is not null;

grant select on public.sp_academy_sites to anon, authenticated;
