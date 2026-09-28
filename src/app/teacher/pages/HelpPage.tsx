/**
 * 도움말 — 좌측 목차 + 우측 본문. 항목은 TOPICS 배열에 추가하면 늘어난다.
 * 첫 항목: 스마트펜 상태표시 (LED 색상표 — 제조사 안내 기반).
 */
import { useState, type ReactNode } from 'react';

type LedBlink = '점등' | '점멸';

/** LED 색 견본 — 점멸이면 깜빡이는 애니메이션 */
function Led({ color, blink }: { color: string; blink: LedBlink }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-3 w-3 rounded-[2px] ${blink === '점멸' ? 'animate-pulse' : ''}`}
        style={{ background: color }}
      />
      {blink}
    </span>
  );
}

/** 전원 OFF — 여러 색 교차 점등 */
function LedCycle() {
  const colors = ['#2b3cf0', '#e83e8c', '#e53935', '#f5c518', '#2e7d32', '#00bcd4'];
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-0.5">
        {colors.map((c, i) => (
          <span
            key={i}
            className="inline-block h-3 w-3 animate-pulse rounded-[2px]"
            style={{ background: c, animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      교차 점등
    </span>
  );
}

const LED_ROWS: Array<{
  state: string;
  led: ReactNode;
  /** 아이글(채점 프로그램)에서 신호를 보내는 상태 그룹 */
  eyegle?: boolean;
}> = [
  { state: '전원 ON', led: <Led color="#2b3cf0" blink="점등" /> },
  { state: '전원 OFF', led: <LedCycle /> },
  { state: '배터리 부족', led: <Led color="#e53935" blink="점멸" /> },
  { state: '충전 중', led: <Led color="#00bcd4" blink="점멸" /> },
  { state: '충전 완료', led: <Led color="#00bcd4" blink="점등" /> },
  { state: '네오스튜디오(BT)와 연결', led: <Led color="#2e7d32" blink="점등" /> },
  { state: 'USB 연결', led: <Led color="#2e7d32" blink="점멸" /> },
  {
    state: '아이글 채점 시도 - 데이터 있음',
    led: <Led color="#f5c518" blink="점등" />,
    eyegle: true,
  },
  {
    state: '아이글 채점 시도 - 데이터 없음',
    led: <Led color="#e83e8c" blink="점멸" />,
    eyegle: true,
  },
  {
    state: '아이글(커넥트)/PC 종료',
    led: <span>전원 off 후 → 충전 중 또는 충전 완료</span>,
    eyegle: true,
  },
  { state: '저장공간 부족', led: <Led color="#f5c518" blink="점멸" /> },
  { state: '펌웨어 업데이트 중', led: <Led color="#2b3cf0" blink="점멸" /> },
  { state: '펌웨어 업데이트 실패', led: <Led color="#f5c518" blink="점멸" /> },
  {
    state: '광학센서 또는 사용환경 점검 필요',
    led: <Led color="#e83e8c" blink="점등" />,
  },
];

function PenLedTopic() {
  return (
    <div>
      <h2 className="text-lg font-bold text-ink">스마트펜 상태표시</h2>
      <p className="mt-1 text-sm text-ink-muted">
        스마트펜 LED 색상으로 현재 상태를 확인할 수 있습니다.
      </p>
      <div className="mt-4 overflow-x-auto border border-line-weak bg-layer-default">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="border-b border-line-weak bg-layer-basement text-xs text-ink-subtle">
              <th className="px-4 py-2.5 font-medium">상태</th>
              <th className="px-4 py-2.5 font-medium">LED 컬러</th>
              <th className="px-4 py-2.5 font-medium">비고</th>
            </tr>
          </thead>
          <tbody>
            {LED_ROWS.map((r) => (
              <tr key={r.state} className="border-b border-line-weak last:border-b-0">
                <td className="px-4 py-2.5 text-ink">{r.state}</td>
                <td className="px-4 py-2.5 text-ink">{r.led}</td>
                <td className="px-4 py-2.5 text-xs text-ink-subtle">
                  {r.eyegle ? '아이글에서 신호 보냄' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-subtle">
        점등 = 계속 켜짐 · 점멸 = 깜빡임. 배터리 부족(빨강 점멸) 시 크래들에
        꽂아 충전해주세요.
      </p>
    </div>
  );
}

// 도움말 항목 — 여기에 추가하면 목차에 늘어난다
const TOPICS: Array<{ id: string; title: string; body: ReactNode }> = [
  { id: 'pen-led', title: '스마트펜 상태표시', body: <PenLedTopic /> },
];

export function HelpPage() {
  const [topicId, setTopicId] = useState(TOPICS[0].id);
  const topic = TOPICS.find((t) => t.id === topicId) ?? TOPICS[0];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-xl font-bold text-ink">도움말</h1>
      <div className="mt-4 flex flex-col gap-6 md:flex-row">
        <nav className="w-full shrink-0 md:w-56">
          <div className="border border-line-weak bg-layer-default p-2">
            {TOPICS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm ${
                  t.id === topicId
                    ? 'bg-neutral-weak font-semibold text-ink'
                    : 'text-ink-muted hover:bg-neutral-weak hover:text-ink'
                }`}
                onClick={() => setTopicId(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        </nav>
        <div className="min-w-0 flex-1">{topic.body}</div>
      </div>
    </div>
  );
}
