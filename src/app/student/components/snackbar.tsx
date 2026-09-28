/**
 * 학생 포털 공용 스낵바 훅.
 * StudentShell 이 SnackbarProvider 로 감싸므로 하위 페이지 어디서든 사용 가능.
 */
import { Snackbar, useSnackbarAdapter } from 'seed-design/ui/snackbar';

export function useStudentSnackbar() {
  const adapter = useSnackbarAdapter();

  const show = (message: string, variant: 'default' | 'positive' | 'critical' = 'default') => {
    adapter.create({
      timeout: 3000,
      render: () => <Snackbar variant={variant} message={message} />,
    });
  };

  return {
    success: (message: string) => show(message, 'positive'),
    error: (message: string) => show(message, 'critical'),
    info: (message: string) => show(message, 'default'),
  };
}
