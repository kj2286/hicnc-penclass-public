-- ============================================================
-- 007 — 플랫폼 설정 저장소 (OCR 엔진 선택 / AI 프롬프트 등)
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
--
-- 서버리스(서비스키)가 읽고 쓰는 key-value 저장소.
-- RLS: admin 만 직접 접근 가능 (학생/선생님은 접근 불가).
-- 보안: OpenRouter 키 등 핵심 시크릿은 이 테이블이 아니라 Vercel 서버
-- 환경변수에만 둔다. 여기엔 엔진 선택값과 부가 키만 저장한다.
-- ============================================================

create table if not exists public.sp_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.sp_settings enable row level security;

drop policy if exists sp_settings_admin_all on public.sp_settings;
create policy sp_settings_admin_all on public.sp_settings for all using (
  public.sp_role() = 'admin'
) with check (
  public.sp_role() = 'admin'
);
