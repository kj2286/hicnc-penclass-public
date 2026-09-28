-- ============================================================
-- 월드 펜클래스 — Supabase 프로젝트 초기화 (001~028 통합, 2026-09-04)
--
-- 지트 펜클래스와 DB 를 분리하려고 만든 파일이다. 새(또는 비어 있는) Supabase
-- 프로젝트의 SQL Editor 에 **이 파일 전체를 한 번에** 붙여넣고 실행하면
-- 테이블·정책·스토리지 버킷·함수가 모두 만들어진다. 여러 번 실행해도 안전하다.
-- 모든 객체는 sp_ 접두사를 쓰므로 다른 서비스와 한 프로젝트에 공존할 수 있다.
--
-- ⚠️ 003 의 진단용 sp_debug 기록은 **뺐다**. 한 번에 실행할 때 방금 만든 테이블을
--    같은 배치에서 다시 참조하다 42P01 로 죽는다(2026-09-04 실패). 옛 사고를
--    되짚는 임시 로그일 뿐이라 004/005 가 어차피 지웠다.
--
-- 실행 후: 설정 > API 에서 URL·anon·service_role 을 복사해
--   ./scripts/switch-supabase.sh <URL> <ANON> <SERVICE_ROLE>
-- 그다음 재배포하고 /signup 에서 학원 계정을 만든다.
-- ============================================================


-- ══════════════════════════════════════════════════════════
-- 001_init.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 펜클래스 (smartpen-platform) 초기 스키마 v1
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- 기존 프로젝트와 공존하도록 모든 객체는 sp_ 접두사를 씁니다.
-- ============================================================

-- ---------- 프로필 (auth.users 1:1) ----------
create table if not exists public.sp_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student', 'teacher', 'admin')),
  name text not null,
  username text unique,
  teacher_id uuid references public.sp_profiles(id) on delete set null,
  must_change_password boolean not null default false,
  -- 발급 직후 선생님이 다시 확인할 수 있도록 임시 비밀번호를 보관.
  -- 학생이 비밀번호를 바꾸면 null 로 지운다.
  temp_password text,
  created_at timestamptz not null default now()
);

create index if not exists sp_profiles_teacher_idx on public.sp_profiles (teacher_id);

-- 호출자의 역할을 RLS 안에서 재귀 없이 읽기 위한 helper
create or replace function public.sp_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.sp_profiles where id = auth.uid()
$$;

-- 호출자(학생)의 담당 선생님 id — RLS 정책에서 sp_profiles 를 인라인 서브쿼리로
-- 조회하면 무한재귀(42P17)가 나므로 반드시 이 definer 함수를 쓴다.
create or replace function public.sp_my_teacher_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select teacher_id from public.sp_profiles where id = auth.uid()
$$;

-- ---------- 펜 ----------
create table if not exists public.sp_pens (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.sp_profiles(id) on delete cascade,
  mac text not null,
  name text not null default '',
  assigned_student_id uuid references public.sp_profiles(id) on delete set null,
  plan text not null default 'none' check (plan in ('none', 'basic_3900', 'plus_4900')),
  plan_status text not null default 'inactive'
    check (plan_status in ('inactive', 'active', 'past_due', 'canceled')),
  plan_started_at timestamptz,
  created_at timestamptz not null default now(),
  unique (teacher_id, mac)
);

create index if not exists sp_pens_teacher_idx on public.sp_pens (teacher_id);

-- ---------- 제출 (학생 → 선생님 필기 영상) ----------
create table if not exists public.sp_submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.sp_profiles(id) on delete cascade,
  teacher_id uuid not null references public.sp_profiles(id) on delete cascade,
  title text not null,
  note_label text,
  page_count int not null default 1,
  stroke_count int not null default 0,
  duration_ms bigint not null default 0,
  written_from timestamptz,
  written_to timestamptz,
  -- sp-strokes 버킷 안 오브젝트 경로: {student_id}/{submission_id}.json.gz
  strokes_path text not null,
  thumbnail_path text,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed')),
  feedback_visible boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists sp_submissions_student_idx on public.sp_submissions (student_id, created_at desc);
create index if not exists sp_submissions_teacher_idx on public.sp_submissions (teacher_id, created_at desc);

-- ---------- 피드백 (제출당 1건, 코멘트 + OCR 원문/교정본) ----------
create table if not exists public.sp_feedback (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.sp_submissions(id) on delete cascade,
  teacher_id uuid not null references public.sp_profiles(id) on delete cascade,
  body text not null default '',
  ocr_text text,
  ocr_edited text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id)
);

-- ---------- RLS ----------
alter table public.sp_profiles enable row level security;
alter table public.sp_pens enable row level security;
alter table public.sp_submissions enable row level security;
alter table public.sp_feedback enable row level security;

-- profiles
drop policy if exists sp_profiles_select on public.sp_profiles;
create policy sp_profiles_select on public.sp_profiles for select using (
  id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  -- 학생이 자기 담당 선생님 프로필(이름)을 읽을 수 있게
  or id = public.sp_my_teacher_id()
);

drop policy if exists sp_profiles_update_self on public.sp_profiles;
create policy sp_profiles_update_self on public.sp_profiles for update using (
  id = auth.uid() or public.sp_role() = 'admin'
);

-- pens
drop policy if exists sp_pens_teacher_all on public.sp_pens;
create policy sp_pens_teacher_all on public.sp_pens for all using (
  teacher_id = auth.uid() or public.sp_role() = 'admin'
) with check (
  teacher_id = auth.uid() or public.sp_role() = 'admin'
);

drop policy if exists sp_pens_student_read on public.sp_pens;
create policy sp_pens_student_read on public.sp_pens for select using (
  assigned_student_id = auth.uid()
);

-- submissions
drop policy if exists sp_submissions_student_insert on public.sp_submissions;
create policy sp_submissions_student_insert on public.sp_submissions for insert with check (
  student_id = auth.uid()
  and teacher_id = public.sp_my_teacher_id()
);

drop policy if exists sp_submissions_select on public.sp_submissions;
create policy sp_submissions_select on public.sp_submissions for select using (
  student_id = auth.uid() or teacher_id = auth.uid() or public.sp_role() = 'admin'
);

drop policy if exists sp_submissions_teacher_update on public.sp_submissions;
create policy sp_submissions_teacher_update on public.sp_submissions for update using (
  teacher_id = auth.uid() or public.sp_role() = 'admin'
);

drop policy if exists sp_submissions_delete on public.sp_submissions;
create policy sp_submissions_delete on public.sp_submissions for delete using (
  student_id = auth.uid() or teacher_id = auth.uid() or public.sp_role() = 'admin'
);

-- feedback
drop policy if exists sp_feedback_teacher_all on public.sp_feedback;
create policy sp_feedback_teacher_all on public.sp_feedback for all using (
  teacher_id = auth.uid() or public.sp_role() = 'admin'
) with check (
  teacher_id = auth.uid() or public.sp_role() = 'admin'
);

drop policy if exists sp_feedback_student_read on public.sp_feedback;
create policy sp_feedback_student_read on public.sp_feedback for select using (
  exists (
    select 1 from public.sp_submissions s
    where s.id = submission_id
      and s.student_id = auth.uid()
      and s.feedback_visible
  )
);

-- ---------- Storage: 필기 데이터 버킷 ----------
insert into storage.buckets (id, name, public)
values ('sp-strokes', 'sp-strokes', false)
on conflict (id) do nothing;

-- 경로 규칙: {student_id}/{submission_id}.json.gz / {student_id}/{submission_id}.png
drop policy if exists sp_strokes_student_write on storage.objects;
create policy sp_strokes_student_write on storage.objects for insert with check (
  bucket_id = 'sp-strokes'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists sp_strokes_read on storage.objects;
create policy sp_strokes_read on storage.objects for select using (
  bucket_id = 'sp-strokes'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.sp_profiles p
      where p.id::text = (storage.foldername(name))[1]
        and p.teacher_id = auth.uid()
    )
    or public.sp_role() = 'admin'
  )
);

drop policy if exists sp_strokes_owner_delete on storage.objects;
create policy sp_strokes_owner_delete on storage.objects for delete using (
  bucket_id = 'sp-strokes'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.sp_role() = 'admin'
  )
);


-- ══════════════════════════════════════════════════════════
-- 002_fix_rls.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 002: sp_profiles RLS 무한재귀 수정 (42P17)
-- 원인: sp_profiles_select 정책 안에서 sp_profiles 를 인라인 서브쿼리로
--       다시 조회 → 같은 정책이 재적용되며 재귀.
-- 해결: SECURITY DEFINER 헬퍼 함수(RLS 우회)로 교체. (idempotent)
-- ============================================================

create or replace function public.sp_my_teacher_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select teacher_id from public.sp_profiles where id = auth.uid()
$$;

drop policy if exists sp_profiles_select on public.sp_profiles;
create policy sp_profiles_select on public.sp_profiles for select using (
  id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  -- 학생이 자기 담당 선생님 프로필(이름)을 읽을 수 있게 (definer 함수라 재귀 없음)
  or id = public.sp_my_teacher_id()
);

-- 제출 insert 정책도 같은 헬퍼로 교체 (동작 동일, 표현만 안전하게)
drop policy if exists sp_submissions_student_insert on public.sp_submissions;
create policy sp_submissions_student_insert on public.sp_submissions for insert with check (
  student_id = auth.uid()
  and teacher_id = public.sp_my_teacher_id()
);


-- ══════════════════════════════════════════════════════════
-- 003_repair_profiles_policies.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 003: sp_profiles 정책 전면 수리 (42P17 잔존 대응)
-- ① 현재 정책을 sp_debug 에 기록(원격 진단용) → ② 이름 불문 전부 삭제
-- → ③ 재귀 없는 정책으로 재생성 → ④ 결과도 sp_debug 에 기록. (idempotent)
-- ============================================================

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'sp_profiles'
  loop
    execute format('drop policy %I on public.sp_profiles', pol.policyname);
  end loop;
end $$;

-- 재생성 (인라인 서브쿼리 금지 — definer 함수만 사용)
create policy sp_profiles_select on public.sp_profiles for select using (
  id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  or id = public.sp_my_teacher_id()
);

create policy sp_profiles_update_self on public.sp_profiles for update using (
  id = auth.uid() or public.sp_role() = 'admin'
);



-- ══════════════════════════════════════════════════════════
-- 004_fix_storage_rls.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 004: 스토리지 읽기 정책을 definer 함수 기반으로 재작성
-- 증상: 파일이 존재하고 선생님이 학생 프로필도 읽을 수 있는데
--       storage.objects 다운로드만 "Object not found"(RLS 거부).
-- 앱은 /api/strokes 폴백으로 이미 동작하지만, 정책도 바로잡아 둔다.
-- 실행: SQL Editor 에 전체 붙여넣기 (⚠️ 아무것도 선택하지 않은 상태로 Run)
-- ============================================================

create or replace function public.sp_can_read_strokes(object_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (storage.foldername(object_name))[1] = auth.uid()::text
    or exists (
      select 1 from public.sp_profiles p
      where p.id::text = (storage.foldername(object_name))[1]
        and p.teacher_id = auth.uid()
    )
    or (select role from public.sp_profiles where id = auth.uid()) = 'admin'
$$;

drop policy if exists sp_strokes_read on storage.objects;
create policy sp_strokes_read on storage.objects for select using (
  bucket_id = 'sp-strokes' and public.sp_can_read_strokes(name)
);

-- 잔여 정리: 진단용 테이블 제거


-- ══════════════════════════════════════════════════════════
-- 005_notifications.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 005: 알림(sp_notifications) + 스토리지 정책 정리(004 포함)
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 (⚠️ 아무것도 선택하지 않은 상태로 Run)
-- idempotent — 재실행 안전.
-- ============================================================

-- ---------- 알림 ----------
create table if not exists public.sp_notifications (
  id uuid primary key default gen_random_uuid(),
  -- 받는 사람 (지금은 학생)
  user_id uuid not null references public.sp_profiles(id) on delete cascade,
  type text not null default 'feedback' check (type in ('feedback')),
  submission_id uuid references public.sp_submissions(id) on delete cascade,
  title text not null,
  body text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists sp_notifications_user_idx
  on public.sp_notifications (user_id, read, created_at desc);

alter table public.sp_notifications enable row level security;

-- 본인 알림만 읽기
drop policy if exists sp_notif_select on public.sp_notifications;
create policy sp_notif_select on public.sp_notifications for select using (
  user_id = auth.uid() or public.sp_role() = 'admin'
);

-- 선생님이 "그 제출의 담당 선생님이고 받는 사람이 그 제출의 학생"일 때만 생성 가능
-- (sp_submissions 참조라 sp_profiles 재귀 없음)
drop policy if exists sp_notif_insert on public.sp_notifications;
create policy sp_notif_insert on public.sp_notifications for insert with check (
  public.sp_role() = 'admin'
  or exists (
    select 1 from public.sp_submissions s
    where s.id = submission_id
      and s.teacher_id = auth.uid()
      and s.student_id = user_id
  )
);

-- 받는 사람이 읽음 처리(update) 가능
drop policy if exists sp_notif_update on public.sp_notifications;
create policy sp_notif_update on public.sp_notifications for update using (
  user_id = auth.uid()
);

-- ---------- (004) 스토리지 읽기 정책 definer 함수화 ----------
create or replace function public.sp_can_read_strokes(object_name text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    (storage.foldername(object_name))[1] = auth.uid()::text
    or exists (
      select 1 from public.sp_profiles p
      where p.id::text = (storage.foldername(object_name))[1]
        and p.teacher_id = auth.uid()
    )
    or (select role from public.sp_profiles where id = auth.uid()) = 'admin'
$$;

drop policy if exists sp_strokes_read on storage.objects;
create policy sp_strokes_read on storage.objects for select using (
  bucket_id = 'sp-strokes' and public.sp_can_read_strokes(name)
);

-- 진단용 임시 테이블 정리(있으면 제거)


-- ══════════════════════════════════════════════════════════
-- 006_soft_delete.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 006 — 학생 소프트 삭제(휴지통) 지원
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
--
-- deleted_at 이 null 이면 재원, 값이 있으면 휴지통(임시보관) 상태.
-- 삭제/복구/영구삭제는 서버리스(api/student-trash.ts, 서비스키)가 수행하므로
-- RLS 정책 변경은 없습니다. 영구삭제는 auth.users 삭제 → FK cascade 로
-- 프로필·제출·피드백이 함께 지워집니다.
-- ============================================================

alter table public.sp_profiles
  add column if not exists deleted_at timestamptz;

-- 재원 학생 목록 조회 최적화 (휴지통 제외 스캔)
create index if not exists sp_profiles_teacher_active_idx
  on public.sp_profiles (teacher_id)
  where deleted_at is null;


-- ══════════════════════════════════════════════════════════
-- 007_settings.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 008_student_profile.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 008 — 학생 프로필 확장 (학생 관리 리스트뷰/추가 팝업 개편)
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
--
-- 필수 입력: 이름(기존 name) + 학년(school_level 초/중/고 + grade 숫자)
-- 선택 입력: 학생/학부모 연락처·학교·수업 시작일·집주소·특이사항·펜 보유
-- 퇴원 상태는 기존 deleted_at(006) 을 그대로 사용한다 (재원=null).
-- ============================================================

alter table public.sp_profiles
  add column if not exists school_level text
    check (school_level is null or school_level in ('초', '중', '고')),
  add column if not exists grade int
    check (grade is null or (grade >= 1 and grade <= 6)),
  add column if not exists student_phone text,
  add column if not exists parent_phone text,
  add column if not exists school text,
  add column if not exists start_date date,
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists has_pen boolean not null default false;


-- ══════════════════════════════════════════════════════════
-- 009_academies.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 009 — 학원(Academy) 구조
-- 관리자 > 학원 관리: 학원 안에 선생님이 소속되고, 학원별로
-- 선생님 수·학원생 수·펜 수를 집계한다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- ============================================================

create table if not exists public.sp_academies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  memo text,
  created_at timestamptz not null default now()
);

-- 선생님 프로필에 소속 학원. 학생의 학원은 담당 선생님을 통해 파생된다.
alter table public.sp_profiles
  add column if not exists academy_id uuid references public.sp_academies(id) on delete set null;

create index if not exists sp_profiles_academy_idx on public.sp_profiles (academy_id);

alter table public.sp_academies enable row level security;

-- 조회: 로그인 사용자 전체 (선생님/학생 화면에서 소속 학원명 표시용)
drop policy if exists sp_academies_select on public.sp_academies;
create policy sp_academies_select on public.sp_academies for select using (
  auth.uid() is not null
);

-- 생성/수정/삭제: 관리자 전용
drop policy if exists sp_academies_admin_write on public.sp_academies;
create policy sp_academies_admin_write on public.sp_academies for all using (
  public.sp_role() = 'admin'
) with check (
  public.sp_role() = 'admin'
);


-- ══════════════════════════════════════════════════════════
-- 010_classroom_save.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 011_pen_number.sql
-- ══════════════════════════════════════════════════════════
-- 011: 펜 영구 번호
-- 펜 관리 [펜 연결] 등록 시 입력한 번호를 저장해, 이후 어디서든 "펜 N"으로 표시.
-- (적용 전에는 클라이언트가 로컬 폴백으로 동작하지만, 기기 간 공유를 위해 적용 권장)
alter table public.sp_pens add column if not exists pen_number int;


-- ══════════════════════════════════════════════════════════
-- 012_paper_owners.sql
-- ══════════════════════════════════════════════════════════
-- 012: 교재(ncode PDF) 소유 매핑
-- NGS 는 선생님 개념이 없는 공용 서버라, 어떤 선생님이 올린 교재인지 여기 기록한다.
-- 교재 만들기 목록은 내 소유(pdf_id)만 노출. (적용 전에는 기존처럼 전체 노출 폴백)
create table if not exists public.sp_paper_owners (
  pdf_id int primary key,
  teacher_id uuid not null references public.sp_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.sp_paper_owners enable row level security;

drop policy if exists sp_paper_owners_teacher_all on public.sp_paper_owners;
create policy sp_paper_owners_teacher_all on public.sp_paper_owners
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());


-- ══════════════════════════════════════════════════════════
-- 013_paper_trash.sql
-- ══════════════════════════════════════════════════════════
-- 013: 교재 휴지통
-- 교재 만들기에서 삭제하면 즉시 지우지 않고 휴지통(deleted_at)으로 이동.
-- 삭제 내역에서 원복(deleted_at=null) 또는 영구 삭제(NGS soft-delete + 행 삭제).
alter table public.sp_paper_owners add column if not exists deleted_at timestamptz;


-- ══════════════════════════════════════════════════════════
-- 014_membership.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 014 — 학원 회원체계 (자가 가입 · 대표자/사용자 선생님 · 학생 배정 · 브랜딩)
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
--
-- 구조:
--   · 학원이 직접 회원가입(이메일) → 가입자는 그 학원의 "대표자" 선생님
--   · 대표자는 선생님관리에서 사용자 선생님 생성(임시 비밀번호 자동 발급)·학생 배정
--   · 학생 "주담당"은 기존처럼 sp_profiles.teacher_id, 추가 배정(공동 담당)만
--     sp_teacher_students 에 저장 — 기존 데이터·정책과 호환
--   · 기존 선생님은 전원 자기 학원의 대표자로 1회 승격(마커로 재실행 방지)
-- ============================================================

-- ---------- 1) 학원 확장: 위치·브랜딩(로고 텍스트/이미지·사이드바 색) ----------
alter table public.sp_academies
  add column if not exists location text,
  add column if not exists logo_text text,
  add column if not exists logo_image_url text,
  add column if not exists theme_color text;

-- ---------- 2) 프로필 확장: 전화번호·대상학생·대표자 플래그 ----------
alter table public.sp_profiles
  add column if not exists phone text,
  add column if not exists student_levels text[],
  add column if not exists is_academy_owner boolean not null default false;

-- ---------- 3) 배정 테이블 (공동 담당 — 주담당 teacher_id 의 "추가" 배정) ----------
create table if not exists public.sp_teacher_students (
  teacher_id uuid not null references public.sp_profiles(id) on delete cascade,
  student_id uuid not null references public.sp_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (teacher_id, student_id)
);
create index if not exists sp_ts_student_idx on public.sp_teacher_students (student_id);

-- ---------- 4) 기존 선생님 1회 승격 (재실행해도 다시 승격하지 않도록 마커) ----------
create table if not exists public.sp_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

do $$
declare t record; aid uuid;
begin
  if exists (select 1 from public.sp_migrations where id = '014_promote_owners') then
    return;
  end if;

  -- 학원이 없는 기존 선생님에게 학원 자동 생성
  for t in
    select id, name from public.sp_profiles
    where role = 'teacher' and academy_id is null
  loop
    insert into public.sp_academies (name)
    values (coalesce(nullif(trim(t.name), ''), '펜클래스') || ' 학원')
    returning id into aid;
    update public.sp_profiles set academy_id = aid where id = t.id;
  end loop;

  -- 이 시점까지의 모든 선생님을 대표자로 승격 (이후 생성되는 사용자 선생님은 제외)
  update public.sp_profiles set is_academy_owner = true where role = 'teacher';

  insert into public.sp_migrations (id) values ('014_promote_owners');
end $$;

-- ---------- 5) definer 헬퍼 (RLS 안 인라인 서브쿼리 금지 원칙) ----------
create or replace function public.sp_my_academy_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select academy_id from public.sp_profiles where id = auth.uid()
$$;

create or replace function public.sp_is_academy_owner()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select is_academy_owner and role = 'teacher'
     from public.sp_profiles where id = auth.uid()),
    false)
$$;

-- 확장: 주담당(teacher_id)이거나 배정 테이블에 있으면 "내 학생".
-- 010 의 교실 저장 정책들이 이 함수를 쓰므로 공동 담당에게 자동 확장된다.
create or replace function public.sp_is_my_student(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.sp_profiles p
    where p.id = sid and p.teacher_id = auth.uid()
  ) or exists(
    select 1 from public.sp_teacher_students ts
    where ts.student_id = sid and ts.teacher_id = auth.uid()
  )
$$;

-- 학생 → 이 선생님이 나에게 배정된 공동 담당인가 (선생님 이름 표시용)
create or replace function public.sp_is_my_assigned_teacher(tid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.sp_teacher_students ts
    where ts.teacher_id = tid and ts.student_id = auth.uid()
  )
$$;

-- 이 학생이 내 학원 소속인가 (학생의 학원 = 주담당 선생님의 학원)
create or replace function public.sp_student_in_my_academy(sid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.sp_profiles s
    join public.sp_profiles t on t.id = s.teacher_id
    where s.id = sid and s.role = 'student'
      and t.academy_id is not null
      and t.academy_id = (select academy_id from public.sp_profiles where id = auth.uid())
  )
$$;

-- 이 선생님이 내 학원 소속인가
create or replace function public.sp_teacher_in_my_academy(tid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.sp_profiles t
    where t.id = tid and t.role = 'teacher'
      and t.academy_id is not null
      and t.academy_id = (select academy_id from public.sp_profiles where id = auth.uid())
  )
$$;

-- ---------- 6) sp_profiles 조회 정책 확장 ----------
-- 추가: 공동 담당 학생 / 학생의 배정 선생님 / 대표자의 학원 구성원(선생님·학생)
drop policy if exists sp_profiles_select on public.sp_profiles;
create policy sp_profiles_select on public.sp_profiles for select using (
  id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  or id = public.sp_my_teacher_id()
  or public.sp_is_my_student(id)
  or public.sp_is_my_assigned_teacher(id)
  or (public.sp_is_academy_owner() and public.sp_teacher_in_my_academy(id))
  or (public.sp_is_academy_owner() and public.sp_student_in_my_academy(id))
);

-- ---------- 7) 배정 테이블 RLS ----------
alter table public.sp_teacher_students enable row level security;

drop policy if exists sp_ts_select on public.sp_teacher_students;
create policy sp_ts_select on public.sp_teacher_students for select using (
  teacher_id = auth.uid()
  or student_id = auth.uid()
  or public.sp_role() = 'admin'
  or (public.sp_is_academy_owner() and public.sp_teacher_in_my_academy(teacher_id))
);

drop policy if exists sp_ts_owner_insert on public.sp_teacher_students;
create policy sp_ts_owner_insert on public.sp_teacher_students for insert with check (
  public.sp_role() = 'admin'
  or (
    public.sp_is_academy_owner()
    and public.sp_teacher_in_my_academy(teacher_id)
    and public.sp_student_in_my_academy(student_id)
  )
);

drop policy if exists sp_ts_owner_delete on public.sp_teacher_students;
create policy sp_ts_owner_delete on public.sp_teacher_students for delete using (
  public.sp_role() = 'admin'
  or (public.sp_is_academy_owner() and public.sp_teacher_in_my_academy(teacher_id))
);

-- ---------- 8) 학원 정보 수정: 대표자 본인 학원만 (테마·로고·이름·위치) ----------
drop policy if exists sp_academies_owner_update on public.sp_academies;
create policy sp_academies_owner_update on public.sp_academies for update using (
  public.sp_is_academy_owner() and id = public.sp_my_academy_id()
) with check (
  public.sp_is_academy_owner() and id = public.sp_my_academy_id()
);

-- ---------- 9) 제출·피드백: 공동 담당 선생님 열람 ----------
drop policy if exists sp_submissions_select on public.sp_submissions;
create policy sp_submissions_select on public.sp_submissions for select using (
  student_id = auth.uid()
  or teacher_id = auth.uid()
  or public.sp_role() = 'admin'
  or public.sp_is_my_student(student_id)
);

-- 공동 담당은 피드백을 "열람"만 (작성·수정은 기존 정책대로 작성자/관리자)
drop policy if exists sp_feedback_coteacher_read on public.sp_feedback;
create policy sp_feedback_coteacher_read on public.sp_feedback for select using (
  exists (
    select 1 from public.sp_submissions s
    where s.id = submission_id and public.sp_is_my_student(s.student_id)
  )
);

-- ---------- 10) 스토리지 읽기: 공동 담당 확장 (001 의 sp_strokes_read 대체) ----------
drop policy if exists sp_strokes_read on storage.objects;
create policy sp_strokes_read on storage.objects for select using (
  bucket_id = 'sp-strokes'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.sp_is_my_student(((storage.foldername(name))[1])::uuid)
    or public.sp_role() = 'admin'
  )
);

-- ---------- 11) 브랜딩 버킷 (로고 이미지 — public 읽기) ----------
insert into storage.buckets (id, name, public)
values ('sp-brand', 'sp-brand', true)
on conflict (id) do nothing;

-- 경로 규칙: {academy_id}/logo-<ts>.<ext> — 대표자만 자기 학원 폴더에 쓰기
drop policy if exists sp_brand_owner_insert on storage.objects;
create policy sp_brand_owner_insert on storage.objects for insert with check (
  bucket_id = 'sp-brand'
  and public.sp_is_academy_owner()
  and (storage.foldername(name))[1] = public.sp_my_academy_id()::text
);

drop policy if exists sp_brand_owner_update on storage.objects;
create policy sp_brand_owner_update on storage.objects for update using (
  bucket_id = 'sp-brand'
  and public.sp_is_academy_owner()
  and (storage.foldername(name))[1] = public.sp_my_academy_id()::text
) with check (
  bucket_id = 'sp-brand'
  and public.sp_is_academy_owner()
  and (storage.foldername(name))[1] = public.sp_my_academy_id()::text
);

drop policy if exists sp_brand_owner_delete on storage.objects;
create policy sp_brand_owner_delete on storage.objects for delete using (
  bucket_id = 'sp-brand'
  and public.sp_is_academy_owner()
  and (storage.foldername(name))[1] = public.sp_my_academy_id()::text
);


-- ══════════════════════════════════════════════════════════
-- 015_paper_kind.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 015 — 교재 종류 (테스트지/시험지/학습지/단순노트)
-- 업로드 시 선생님이 고른 종류를 소유 매핑에 함께 기록한다.
-- '단순노트' 는 리뷰에서 문항 디텍션 대신 "적힌 내용 안내" 분석을 쓴다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists kind text
  check (kind is null or kind in ('테스트지', '시험지', '학습지', '단순노트'));


-- ══════════════════════════════════════════════════════════
-- 016_pen_registry.sql
-- ══════════════════════════════════════════════════════════
-- 016: 학원 펜 레지스트리 — 종류·모델·이관 이력·공유 학생 + 학원 단위 공동 관리
--
-- 배경: 펜은 학원 자산이다. 크래들에서 등록하고, 학생에게 배정하며,
-- 주인이 바뀌어도(이관) 이전 학생의 필기 기록은 서버에 그대로 남는다.
-- 한 펜을 여러 학생이 나눠 쓰는 구조(shared_student_ids)도 지원한다.

alter table public.sp_pens
  add column if not exists model text not null default '',
  add column if not exists kind text not null default ''
    check (kind in ('', 'ballpen', 'sharp')),
  add column if not exists holder_history jsonb not null default '[]'::jsonb,
  add column if not exists shared_student_ids jsonb not null default '[]'::jsonb,
  -- 수집 워터마크: 이 시각(ms)까지의 획은 이미 수신됨. 이후의 새 획은
  -- 펜 시계가 틀려도 **수신일** 문서로 저장한다 (펜 RTC 오차로 필기가
  -- 과거 날짜에 묻히는 사고 방지 — 2026-08-12 김경수 건).
  add column if not exists collected_until_ms bigint not null default 0;

-- 같은 학원 선생님끼리 펜을 공동 관리한다 (조회·등록·배정·이관).
-- 기존 sp_pens_teacher_all(본인+admin) 정책과 OR 로 합쳐진다.
drop policy if exists sp_pens_academy_all on public.sp_pens;
create policy sp_pens_academy_all on public.sp_pens for all using (
  public.sp_teacher_in_my_academy(teacher_id)
) with check (
  public.sp_teacher_in_my_academy(teacher_id)
);


-- ══════════════════════════════════════════════════════════
-- 017_academy_site.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 018_academy_applications.sql
-- ══════════════════════════════════════════════════════════
-- 018: 학원 도입 신청 접수 (펜클래스 랜딩페이지 → 슈퍼관리자)
--
-- 구조 결정(2026-08-17):
--   · **관리자는 웹에서 총괄**한다 — 신청 접수·학원 개설·홈페이지 배포 전부 웹.
--   · **학원은 PC 프로그램에서 로그인**해 쓴다.
--   그래서 신청서는 로그인 없이(anon) 넣을 수 있어야 하고,
--   읽기·상태 변경은 슈퍼관리자만 할 수 있어야 한다.

create table if not exists public.sp_academy_applications (
  id uuid primary key default gen_random_uuid(),
  academy_name text not null,
  location text not null,
  student_count int,
  teacher_count int,
  contact_name text,
  contact_phone text not null,
  memo text,
  -- new(접수) → contacted(연락함) → done(개설 완료) / rejected(보류)
  status text not null default 'new'
    check (status in ('new', 'contacted', 'done', 'rejected')),
  /** 관리자 메모 — 통화 내용 등 */
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sp_academy_applications_created_idx
  on public.sp_academy_applications (created_at desc);

alter table public.sp_academy_applications enable row level security;

-- 접수: 로그인 없이 누구나 넣을 수 있다 (랜딩페이지 폼).
-- 넣기만 가능하고 조회는 불가 — 남의 신청서를 볼 수 없어야 한다.
drop policy if exists sp_apps_public_insert on public.sp_academy_applications;
create policy sp_apps_public_insert on public.sp_academy_applications
  for insert to anon, authenticated with check (true);

-- 조회·수정·삭제: 슈퍼관리자만.
drop policy if exists sp_apps_admin_all on public.sp_academy_applications;
create policy sp_apps_admin_all on public.sp_academy_applications
  for all using (
    exists (
      select 1 from public.sp_profiles
      where id = auth.uid() and role = 'admin'
    )
  ) with check (
    exists (
      select 1 from public.sp_profiles
      where id = auth.uid() and role = 'admin'
    )
  );


-- ══════════════════════════════════════════════════════════
-- 019_application_email.sql
-- ══════════════════════════════════════════════════════════
-- 019: 도입 신청서에 이메일 추가
--
-- 전화번호를 잘못 적으면 그 신청은 되물을 방법이 없어 통째로 죽는다.
-- 연락 경로를 둘로 두어 하나가 틀려도 닿을 수 있게 한다(사용자 요구 2026-08-17).

alter table public.sp_academy_applications
  add column if not exists contact_email text;


-- ══════════════════════════════════════════════════════════
-- 020_submission_delete.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 021_paper_prompts.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 021 — 교재·문항별 AI 프롬프트 (학원 개별 설정, 2026-08-22)
--
-- 학원마다 학생 평가 방식이 달라, 운영사 공통 프롬프트에 더해
-- 학원이 교재 전체/문항별 추가 지시문을 정의할 수 있게 한다.
-- 토글(OFF)이면 기존 공통(수학비서) 프롬프트만 사용 — 완전 하위호환.
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

-- 학원 설정 토글 — 대표자만 학원 설정에서 켠다 (기본 OFF)
alter table public.sp_academies
  add column if not exists custom_prompts_enabled boolean not null default false;

-- 교재·문항별 프롬프트
create table if not exists public.sp_paper_prompts (
  academy_id uuid not null references public.sp_academies(id) on delete cascade,
  pdf_id int not null,
  -- 'paper' = 교재 전체, 'q{번호}' = 문항별 (예: q3)
  scope text not null,
  prompt text not null,
  updated_at timestamptz not null default now(),
  primary key (academy_id, pdf_id, scope)
);

alter table public.sp_paper_prompts enable row level security;

-- 같은 학원 선생님은 읽고 쓸 수 있다 (토글 자체는 학원 설정=대표자 관리)
drop policy if exists sp_paper_prompts_academy_rw on public.sp_paper_prompts;
create policy sp_paper_prompts_academy_rw on public.sp_paper_prompts
  for all using (
    academy_id = (select academy_id from public.sp_profiles where id = auth.uid())
  ) with check (
    academy_id = (select academy_id from public.sp_profiles where id = auth.uid())
  );


-- ══════════════════════════════════════════════════════════
-- 022_paper_pages.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 022 — 교재의 특수 페이지 지정 (표지 본인정보 / 별도 정답지)
--
-- 업로드 시 선생님이 지정: 표지 본인정보 기입란 페이지, 정답지 페이지.
-- 필기 기록 화면이 본인정보 대조·정답지 기준 채점에 사용한다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists info_page int,
  add column if not exists answer_page int;


-- ══════════════════════════════════════════════════════════
-- 023_paper_lt.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 023 — 테스트지의 LT 종류 (초등LT / 중등LT)
--
-- 업로드에서 종류를 '테스트지' 로 고르면 LT 종류를 함께 고른다.
-- 리뷰 화면이 이 값으로 "이 교재에 있어야 할 단계" 를 알고 필기 기록과 대조한다.
--   초등LT = 계산식 · 1단계 · 2단계 · 3단계
--   중등LT = 1단계 · 2단계 · 3단계
-- 단계 구성만 고정이고 **문항 수는 교재마다 다르다** — 칼럼으로 두지 않는다.
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists lt_type text
  check (lt_type is null or lt_type in ('초등LT', '중등LT'));


-- ══════════════════════════════════════════════════════════
-- 024_solutions_read.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 025_solutions_write.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 026_paper_subject.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 026 — 교재 과목 (수학·국어·영어, 2026-09-04)
--
-- 문항 인식 프롬프트가 "이 이미지는 수학 교재의 한 페이지입니다" 로 고정돼
-- 있어, 국어·영어 시험지를 넣으면 모델이 지시대로 {"problems":[]} 를 돌려주고
-- 문항이 하나도 안 잡혔다(사용자 신고 2026-09-04). 업로드할 때 과목을 받아
-- 인식·채점·분석 프롬프트를 그 과목으로 돌린다.
--
-- null = 과목 미지정. 기존 교재는 전부 수학이라 코드가 null 을 수학으로 읽는다.
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요. (idempotent)
-- https://supabase.com/dashboard
-- ============================================================

alter table public.sp_paper_owners
  add column if not exists subject text;

-- 값은 앱이 강제하지만, 오타가 들어오면 인식 프롬프트가 통째로 어긋나므로
-- DB 에서도 막는다. 기존 행(null)은 그대로 통과한다.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sp_paper_owners_subject_chk'
  ) then
    alter table public.sp_paper_owners
      add constraint sp_paper_owners_subject_chk
      check (subject is null or subject in ('수학', '국어', '영어'));
  end if;
end $$;


-- ══════════════════════════════════════════════════════════
-- 027_storage_write_uuid_guard.sql
-- ══════════════════════════════════════════════════════════
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


-- ══════════════════════════════════════════════════════════
-- 028_paper_subject_science.sql
-- ══════════════════════════════════════════════════════════
-- ============================================================
-- 028 — 교재 과목에 **과학** 추가 (2026-09-04)
--
-- 026 이 subject 를 ('수학','국어','영어') 로 못박아 두어서, 과목을 과학으로
-- 지정하면 CHECK 제약(sp_paper_owners_subject_chk)에 걸려 저장이 실패한다.
-- 앱은 이미 수학·영어·국어·과학 넷을 다루므로 제약을 다시 만들어 맞춘다.
--
-- 제약을 drop 한 뒤 재생성한다 — 여러 번 실행해도 결과가 같다(idempotent).
-- 기존 행(null 포함)은 그대로 통과한다.
--
-- Supabase SQL Editor 에 통째로 붙여넣어 1회 실행하세요.
-- https://supabase.com/dashboard
-- ============================================================

-- 026 을 건너뛴 DB 에서도 그대로 돌도록 컬럼부터 보장한다.
alter table public.sp_paper_owners
  add column if not exists subject text;

alter table public.sp_paper_owners
  drop constraint if exists sp_paper_owners_subject_chk;

alter table public.sp_paper_owners
  add constraint sp_paper_owners_subject_chk
  check (subject is null or subject in ('수학', '국어', '영어', '과학'));
