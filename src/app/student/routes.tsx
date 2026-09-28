import type { RouteObject } from 'react-router-dom';
import { HomePage } from './HomePage';
import { PenPage } from './PenPage';
import { NotesPage } from './NotesPage';
import { ReplayPage } from './ReplayPage';
import { SubmissionsPage } from './SubmissionsPage';
import { SubmissionDetailPage } from './SubmissionDetailPage';
import { SettingsPage } from './SettingsPage';

export const studentRoutes: RouteObject[] = [
  { index: true, element: <HomePage /> },
  { path: 'pen', element: <PenPage /> },
  { path: 'notes', element: <NotesPage /> },
  { path: 'notes/replay', element: <ReplayPage /> },
  { path: 'submissions', element: <SubmissionsPage /> },
  { path: 'submissions/:id', element: <SubmissionDetailPage /> },
  { path: 'settings', element: <SettingsPage /> },
];
