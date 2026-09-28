import { BookOpen, CircleHelp, Settings, Usb, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SnackbarProvider } from 'seed-design/ui/snackbar';
import { ForcePasswordChange } from '@/app/auth/ForcePasswordChange';
import { PortalShell, type NavItem } from '@/components/PortalShell';
import { AcademySettingsDialog } from './components/AcademySettingsDialog';
import { useSessionStore } from '@/store/session.store';
import {
  wireMultipenBus,
  wireMultipenPersistence,
} from '@/store/multipen.store';
import { wireClassroomAutoSave } from '@/lib/classroom-save';
import { wireAutoGradeCatchUp } from '@/lib/auto-grade';
import { listMyStudents, listStudentSubmissions } from '@/lib/api';
import { applyBrandIcon, clearBrandIcon, isDesk } from '@/lib/desk';

const ITEMS: NavItem[] = [
  { to: '/t/papers', label: '교재 만들기', icon: <BookOpen size={18} /> },
  { to: '/t/students', label: '학생 관리', icon: <Users size={18} /> },
  // 학생 노트(/t/inbox)는 보완 전까지 제거 (2026-08-11 사용자 요청) —
  // 학생별 필기·리뷰는 학생 관리 → 노트 경로로 접근한다.
  // 실시간 라이브(/t/live)는 메뉴에서 숨김 (2026-08-27 사용자 요청 — "지금은 필요
  // 없다, 나중에 다른 프로젝트에서 다시 보자"). **화면·라우트는 그대로 남겨 둔다**
  // — 주소로는 여전히 열리고, 되살릴 때 이 줄만 풀면 된다.
  // { to: '/t/live', label: '실시간 라이브', icon: <MonitorPlay size={18} /> },
  // 펜 관리(/t/pens)는 2026-08-12 제거 — 펜 배정은 학생 관리, 수신은 크래들(PC)
  // 구독·결제는 구독제 제외 방침에 따라 메뉴에서 제거 (라우트만 잔존)
];

/** 도움말은 **항상 맨 아래** — Figma 순서(작업 메뉴들 → 도움말) */
const HELP_ITEM: NavItem = {
  to: '/t/help',
  label: '도움말',
  icon: <CircleHelp size={18} />,
};

// PC 프로그램(하이씨앤씨 펜클래스)에서만 크래들 메뉴를 노출한다 — 브라우저는 USB 접근 불가
const DESK_ITEMS: NavItem[] = [
  ...ITEMS,
  { to: '/t/desk', label: '크래들 (PC)', icon: <Usb size={18} /> },
];

export function TeacherShell() {
  const profile = useSessionStore((s) => s.profile);
  // 원장 전용 학원 설정(나의 정보·로고·테마) — GNB 이름 옆 톱니로 연다
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 교실 모드 전역 와이어링 — 어느 페이지에 있어도 펜 스트로크 수집·자동 저장이
  // 계속된다 (라이브 페이지를 벗어나도 저장 중단 없음).
  useEffect(() => {
    wireMultipenBus();
    wireClassroomAutoSave();
    // 미처리 AI 문서 따라잡기 — 앱 재시작으로 끊긴 채점·분석을 이어서 처리.
    // 완료 문서는 상태 파일 확인만 하고 아무 호출도 하지 않는다.
    void wireAutoGradeCatchUp({
      listStudents: listMyStudents,
      listSubmissions: listStudentSubmissions,
    });
  }, []);
  useEffect(() => {
    if (profile?.id) wireMultipenPersistence(profile.id);
  }, [profile?.id]);

  // 학원 로고를 PC 앱 아이콘으로 — B2B 화이트라벨.
  // 로고를 바꾸면 다음 진입(또는 재로그인)에 자동 반영된다. 브라우저에서는 무동작.
  // 실패해도 앱 사용에는 지장이 없으므로 조용히 넘어간다(로고 없는 학원이 다수).
  const academyLogo = useSessionStore((s) => s.academy?.logoImageUrl) ?? null;
  useEffect(() => {
    if (!isDesk()) return;
    // 앱 번들 아이콘을 로그인 후 학원 로고로 덮어쓰면 오히려 품질이 낮은
    // 원본 로고(작은 PNG)로 바뀐다. 런타임 교체는 쓰지 않는다 — 다학원
    // 화이트라벨이 다시 필요해지면 이 이펙트를 되살릴 것.
    void academyLogo;
    void applyBrandIcon;
    void clearBrandIcon;
  }, [academyLogo]);

  // 임시 비밀번호로 로그인한 사용자 선생님은 비번을 바꿔야 입장
  if (profile?.role === 'teacher' && profile.mustChangePassword) {
    return <ForcePasswordChange />;
  }

  const items = [...(isDesk() ? DESK_ITEMS : ITEMS), HELP_ITEM];

  return (
    <SnackbarProvider>
      <PortalShell
        roleLabel="선생님"
        items={items}
        brandHeader={
          <Link to="/t/papers" className="hc-product-brand" aria-label="하이씨앤씨 펜클래스">
            <img src="/brand/hicnc-logo.png" alt="하이씨앤씨" width={100} height={32} draggable={false} />
            <span>펜클래스</span>
          </Link>
        }
        userAction={
          profile?.isAcademyOwner ? (
            <button
              type="button"
              aria-label="학원 설정"
              className="rt-gnb-icon p-2"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={16} />
            </button>
          ) : undefined
        }
      />
      {profile?.isAcademyOwner && (
        <AcademySettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
        />
      )}
    </SnackbarProvider>
  );
}
