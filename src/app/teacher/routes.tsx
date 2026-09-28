import { Navigate, type RouteObject } from 'react-router-dom';
import { StudentsPage } from './pages/StudentsPage';
import { StudentNotesPage } from './pages/StudentNotesPage';
import { ReviewPage } from './pages/ReviewPage';
import { LivePage } from './pages/LivePage';
import { PapersPage } from './pages/PapersPage';
import { DeskCradlePage } from './pages/DeskCradlePage';
import { ReportPage } from './pages/ReportPage';
import { HelpPage } from './pages/HelpPage';

export const teacherRoutes: RouteObject[] = [
  { index: true, element: <Navigate to="papers" replace /> },
  { path: 'students', element: <StudentsPage /> },
  { path: 'students/:id/notes', element: <StudentNotesPage /> },
  { path: 'submissions/:id', element: <ReviewPage /> },
  // 학습분석 리포트 — 리뷰에서 생성한 문서를 편집·인쇄
  { path: 'submissions/:id/report', element: <ReportPage /> },
  { path: 'live', element: <LivePage /> },
  { path: 'papers', element: <PapersPage /> },
  // PC 프로그램(하이씨앤씨 펜클래스) 전용 — 브라우저에서는 안내만 표시
  { path: 'desk', element: <DeskCradlePage /> },
  { path: 'help', element: <HelpPage /> },
];
