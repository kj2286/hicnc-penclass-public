import { useEffect } from 'react';
import { SnackbarProvider } from 'seed-design/ui/snackbar';
import { ReportPage } from './app/teacher/pages/ReportPage';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from 'react-router-dom';
import { useSessionStore, type Role } from '@/store/session.store';
import { LoginPage } from '@/app/auth/LoginPage';
import { SignupPage } from '@/app/auth/SignupPage';
import { SetupRequiredPage } from '@/app/auth/SetupRequiredPage';
import { supabase } from '@/lib/supabase';
import { LandingPage } from '@/app/landing/LandingPage';
import { TeacherShell } from '@/app/teacher/TeacherShell';
import { teacherRoutes } from '@/app/teacher/routes';

export function roleHome(role: Role): string {
  switch (role) {
    case 'student':
      return '/login';
    case 'teacher':
      return '/t/papers';
    // 슈퍼관리자 화면은 하이씨앤씨 펜클래스에 없다 — 타입만 유지하고 로그인으로 보낸다
    case 'admin':
      return '/login';
  }
}

function RequireBackend() {
  return supabase ? <Outlet /> : <Navigate to="/setup" replace />;
}

function RequireRole({ role }: { role: Role }) {
  const { status, profile } = useSessionStore();
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-ink-muted">
        불러오는 중…
      </div>
    );
  }
  if (status === 'signedOut' || !profile) {
    return <Navigate to="/login" replace />;
  }
  if (profile.role !== role) {
    return <Navigate to={roleHome(profile.role)} replace />;
  }
  return <Outlet />;
}

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/t/papers" replace /> },
  { path: '/about', element: <LandingPage /> },
  {
    path: '/setup',
    element: supabase ? <Navigate to="/t/papers" replace /> : <SetupRequiredPage />,
  },
  {
    element: <RequireBackend />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      // 리포트 공유 링크 — **로그인 없이** 열린다 (읽기 전용)
      {
        // 🚨 ReportPage 는 useToast() 를 쓴다 — SnackbarProvider 없이 렌더하면
        //    페이지가 통째로 죽는다(2026-08-27 QA 에서 잡음: 공유 링크 전부 백지).
        path: '/r/:id',
        element: (
          <SnackbarProvider>
            <ReportPage publicMode />
          </SnackbarProvider>
        ),
      },
      { path: '/s/*', element: <Navigate to="/login" replace /> },
      {
        element: <RequireRole role="teacher" />,
        children: [
          { path: '/t', element: <TeacherShell />, children: teacherRoutes },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export default function App() {
  const init = useSessionStore((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    // 드롭존 밖에 파일을 떨어뜨리면 브라우저·웹뷰가 그 파일로 이동해 버린다.
    // PC 프로그램(하이씨앤씨 펜클래스 0.1.1)은 Tauri 의 드래그 가로채기를 껐으므로
    // 이 보호막이 없으면 PDF 를 잘못 놓는 순간 앱 화면이 통째로 PDF 로 바뀐다.
    // 드롭존(PapersPage)은 자기 핸들러에서 파일을 먼저 받으니 영향이 없다.
    const swallow = (ev: DragEvent) => ev.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);
  return <RouterProvider router={router} />;
}
