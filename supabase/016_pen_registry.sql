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
