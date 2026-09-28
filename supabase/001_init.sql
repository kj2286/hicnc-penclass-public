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
