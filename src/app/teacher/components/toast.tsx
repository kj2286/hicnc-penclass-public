/** SEED 스낵바 어댑터를 한 줄로 쓰기 위한 훅. TeacherShell 의 SnackbarProvider 하위에서만 사용. */
import { useCallback } from 'react';
import { Snackbar, useSnackbarAdapter } from 'seed-design/ui/snackbar';

export type ToastVariant = 'default' | 'positive' | 'critical';

export function useToast() {
  const adapter = useSnackbarAdapter();
  return useCallback(
    (message: string, variant: ToastVariant = 'default') => {
      adapter.create({
        timeout: 3000,
        render: () => <Snackbar message={message} variant={variant} />,
      });
    },
    [adapter],
  );
}
