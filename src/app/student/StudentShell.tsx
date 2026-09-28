import {
  Bluetooth,
  Home,
  Inbox,
  NotebookPen,
  Settings,
} from 'lucide-react';
import { SnackbarProvider } from 'seed-design/ui/snackbar';
import { PortalShell, type NavItem } from '@/components/PortalShell';
import { ForcePasswordChange } from '@/app/auth/ForcePasswordChange';
import { useSessionStore } from '@/store/session.store';

const ITEMS: NavItem[] = [
  { to: '/s', label: '홈', icon: <Home size={18} />, end: true },
  { to: '/s/pen', label: '스마트펜 연결', icon: <Bluetooth size={18} /> },
  { to: '/s/notes', label: '필기 기록', icon: <NotebookPen size={18} /> },
  { to: '/s/submissions', label: '보낸 필기 · 피드백', icon: <Inbox size={18} /> },
  { to: '/s/settings', label: '설정', icon: <Settings size={18} /> },
];

export function StudentShell() {
  const profile = useSessionStore((s) => s.profile);

  // 임시 비밀번호 로그인 — 변경 전까지 포털 진입 차단
  if (profile?.role === 'student' && profile.mustChangePassword) {
    return <ForcePasswordChange />;
  }

  return (
    <SnackbarProvider>
      <PortalShell roleLabel="학생" items={ITEMS} />
    </SnackbarProvider>
  );
}
