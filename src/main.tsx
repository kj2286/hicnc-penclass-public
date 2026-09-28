import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { bootstrapPenSdk } from '@/lib/pen-sdk-client';
import { wireConnectionBus } from '@/store/connection.store';
import { wirePenBus } from '@/store/pen.store';
import { wireStrokeBus } from '@/store/stroke.store';
import { wireSettingsBus } from '@/store/settings.store';
import { wireOfflineBus } from '@/store/offline.store';
import 'katex/dist/katex.min.css';
import './index.css';
import './theme/apple-theme.css';
import './theme/hicnc-theme.css';

try {
  bootstrapPenSdk();
  // React effect 이전(모듈 스코프)에 펜 이벤트 버스 구독을 연결한다.
  wireConnectionBus();
  wirePenBus();
  wireStrokeBus();
  wireSettingsBus();
  wireOfflineBus();
} catch (err) {
  console.error('[bootstrapPenSdk]', err);
}

// ── DEV 전용 QA 훅 — 원격 라이브(Mode A) 전송 계층 검증용.
// import.meta.env.DEV 가드로 운영 번들에는 포함되지 않는다.
if (import.meta.env.DEV) {
  void Promise.all([
    import('@/lib/live-stream'),
    import('@/store/session.store'),
    import('@/lib/classroom-save'),
    import('@/store/multipen.store'),
  ]).then(([live, sess, cls, mp]) => {
    (window as unknown as { __live?: unknown }).__live = {
      startShare: live.startLiveShare,
      subscribe: live.subscribeLiveClass,
      profile: () => sess.useSessionStore.getState().profile,
    };
    (window as unknown as { __classroom?: unknown }).__classroom = {
      flushAll: cls.flushAllPens,
      status: () => cls.useClassroomSaveStatus.getState().byMac,
      // E2E 전용 — 헤드리스에서 펜 번호 부여(BLE 연결 플로우 대체)
      setNumber: (mac: string, n: string) =>
        mp.useMultipenStore.getState().setPenNumber(mac, n),
    };
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
