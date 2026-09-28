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
