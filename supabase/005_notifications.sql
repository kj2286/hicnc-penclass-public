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
drop table if exists public.sp_debug;
