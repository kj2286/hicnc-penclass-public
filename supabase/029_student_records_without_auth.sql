-- 029 — 학생 기록과 로그인 계정 분리 (2026-09-29)
-- 검토용 업그레이드 SQL. 이 변경만으로 기존 Auth 계정이나 비밀번호를 삭제·변경하지 않는다.
-- 대상: 001~028을 적용한 하이씨앤씨 DB의 sp_profiles 전체 행.
-- 기존 id와 학생 필기/제출/펜 참조를 유지하고, 현재 Auth 연결만 auth_user_id에 복사한다.
-- 신규 학생: Auth 연결 없이 저장. 교사/관리자: 기존 id = auth.uid() 규칙과 삭제 cascade 유지.
-- 학생 영구삭제는 이 앱의 프로필·필기만 지운다. 다른 앱도 쓸 수 있는 기존 Auth 계정은 남긴다.
-- 적용 전 전체 SQL과 대상 DB를 검토하고 승인받아 한 번에 실행한다. 앱 배포보다 먼저 적용한다.

begin;
set local lock_timeout = '5s';
lock table public.sp_profiles in share row exclusive mode;

alter table public.sp_profiles add column if not exists auth_user_id uuid;

-- 기존 id → auth.users FK가 남아 있는 첫 적용에서만 연결을 옮긴다.
-- 재실행할 때 새 학생을 우연히 같은 UUID인 Auth 계정에 연결하지 않는다.
do $sp_move_auth_link$
declare
  old_fk record;
  id_attribute smallint;
  auth_id_attribute smallint;
  found_old_fk boolean := false;
begin
  select attnum into strict id_attribute from pg_attribute
    where attrelid = 'public.sp_profiles'::regclass and attname = 'id' and not attisdropped;
  select attnum into strict auth_id_attribute from pg_attribute
    where attrelid = 'auth.users'::regclass and attname = 'id' and not attisdropped;

  for old_fk in
    select conname from pg_constraint
    where conrelid = 'public.sp_profiles'::regclass and confrelid = 'auth.users'::regclass
      and contype = 'f' and conkey = array[id_attribute] and confkey = array[auth_id_attribute]
  loop
    found_old_fk := true;
    execute format('alter table public.sp_profiles drop constraint %I', old_fk.conname);
  end loop;

  if found_old_fk then
    if exists (select 1 from public.sp_profiles where auth_user_id is not null and auth_user_id <> id) then
      raise exception '029 aborted: unexpected existing profile Auth link';
    end if;
    update public.sp_profiles set auth_user_id = id where auth_user_id is null;
  end if;
end
$sp_move_auth_link$;

-- id를 바꾸거나 학생 필기 FK를 새로 만들 필요가 없다.
alter table public.sp_profiles drop constraint if exists sp_profiles_auth_user_id_fkey;
alter table public.sp_profiles add constraint sp_profiles_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users(id) on delete cascade;
create unique index if not exists sp_profiles_auth_user_id_idx on public.sp_profiles(auth_user_id);

-- 기존 교사 등록/빠르게 시작 API는 계속 id만 전송할 수 있다.
create or replace function public.sp_set_profile_auth_link()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.role in ('teacher', 'admin') and new.auth_user_id is null then
    new.auth_user_id := new.id;
  end if;
  return new;
end
$$;
drop trigger if exists sp_profiles_set_auth_link on public.sp_profiles;
create trigger sp_profiles_set_auth_link before insert or update on public.sp_profiles
  for each row execute function public.sp_set_profile_auth_link();

-- 기존 RLS와 서버 인증의 id = auth.uid() 가정을 명시적으로 보존한다.
alter table public.sp_profiles drop constraint if exists sp_profiles_auth_link_check;
alter table public.sp_profiles add constraint sp_profiles_auth_link_check check (
  (auth_user_id is null or auth_user_id = id)
  and (role = 'student' or auth_user_id is not null)
);
alter table public.sp_profiles drop constraint if exists sp_profiles_student_credentials_check;
alter table public.sp_profiles add constraint sp_profiles_student_credentials_check check (
  role <> 'student' or auth_user_id is not null
  or (username is null and temp_password is null and must_change_password = false)
);

-- Auth 연결 및 권한 열은 서비스 API만 수정한다. 일반 프로필 수정은 유지한다.
revoke update on table public.sp_profiles from public, anon, authenticated;
grant update (
  name, username, must_change_password, temp_password, created_at, deleted_at,
  school_level, grade, student_phone, parent_phone, school, start_date, address,
  notes, has_pen, phone, student_levels
) on table public.sp_profiles to authenticated;
grant select, insert, update, delete on table public.sp_profiles to service_role;
do $sp_profile_privileges$
declare
  api_role text;
  protected_column text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    foreach protected_column in array array['id', 'auth_user_id', 'role', 'teacher_id', 'academy_id', 'is_academy_owner'] loop
      if has_column_privilege(api_role, 'public.sp_profiles', protected_column, 'UPDATE') then
        raise exception '029 aborted: % can update protected profile column %', api_role, protected_column;
      end if;
    end loop;
  end loop;
end
$sp_profile_privileges$;

-- 기존 학생 토큰도 이 앱의 테이블을 사용하지 못한다. 다른 앱의 Auth/테이블은 건드리지 않는다.
-- sp_role()은 SECURITY DEFINER로 프로필 RLS를 우회하므로 프로필 정책에서도 재귀하지 않는다.
-- anon 정책에는 적용하지 않아 공개 학원 사이트와 비로그인 신청을 유지한다.
do $sp_disable_student_access$
declare
  app_table text;
begin
  foreach app_table in array array[
    'sp_profiles', 'sp_pens', 'sp_submissions', 'sp_feedback', 'sp_notifications',
    'sp_settings', 'sp_academies', 'sp_paper_owners', 'sp_teacher_students',
    'sp_migrations', 'sp_academy_applications', 'sp_paper_prompts'
  ] loop
    execute format('alter table public.%I enable row level security', app_table);
    execute format('drop policy if exists sp_no_student_sessions on public.%I', app_table);
    execute format(
      'create policy sp_no_student_sessions on public.%I as restrictive for all to authenticated using (coalesce(public.sp_role() in (''teacher'', ''admin''), false)) with check (coalesce(public.sp_role() in (''teacher'', ''admin''), false))',
      app_table
    );
  end loop;
end
$sp_disable_student_access$;

-- Auth만 남은 옛 학생도 자신의 옛 UUID 경로에 다시 업로드할 수 없다.
-- academy-sites 등 다른 버킷과 anon의 공개 로고 조회에는 적용하지 않는다.
drop policy if exists sp_no_student_storage_sessions on storage.objects;
create policy sp_no_student_storage_sessions on storage.objects as restrictive for all to authenticated
using (
  bucket_id not in ('sp-strokes', 'sp-brand')
  or coalesce(public.sp_role() in ('teacher', 'admin'), false)
)
with check (
  bucket_id not in ('sp-strokes', 'sp-brand')
  or coalesce(public.sp_role() in ('teacher', 'admin'), false)
);

commit;
