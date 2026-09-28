/** 한국 시간 고정 날짜 회귀 테스트 — 자정 경계에서 UTC 날짜가 새면 안 된다.
 *  실사고(2026-08-18): 리포트 생성일을 ISO slice 로 표기해 한국 자정 이후 전날로 보임. */
import {
  kstDateKey,
  kstDayLabel,
  kstLongDate,
  kstMonthDay,
  kstShortDate,
  kstStamp,
} from '../src/lib/kst';

let pass = 0,
  fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) {
    pass++;
    console.log(`PASS  ${n}`);
  } else {
    fail++;
    console.log(`FAIL  ${n} — got ${String(got)}`);
  }
};

// 한국 8/19 00:30 = UTC 8/18 15:30 — **UTC 로 자르면 하루 어긋나는** 경계
const midnight = '2026-08-18T15:30:00.000Z';
ok('자정 경계: kstShortDate 는 19일', kstShortDate(midnight) === '26.08.19', kstShortDate(midnight));
ok('자정 경계: kstDateKey 는 19일', kstDateKey(Date.parse(midnight)) === '2026-08-19', kstDateKey(Date.parse(midnight)));
ok('자정 경계: kstStamp 시각까지', kstStamp(midnight) === '26.08.19 00:30', kstStamp(midnight));
ok('자정 경계: kstMonthDay', kstMonthDay(Date.parse(midnight)) === '8월 19일', kstMonthDay(Date.parse(midnight)));
ok('자정 경계: kstLongDate', kstLongDate(Date.parse(midnight)) === '2026년 8월 19일', kstLongDate(Date.parse(midnight)));

// 한낮(UTC 03:00 = KST 12:00) — 날짜 동일 구간도 정상
const noon = '2026-08-18T03:00:00.000Z';
ok('한낮: kstShortDate 18일', kstShortDate(noon) === '26.08.18', kstShortDate(noon));

// 라벨 변환
ok('kstDayLabel: 0 안 붙임', kstDayLabel('2026-08-09') === '2026.8.9', kstDayLabel('2026-08-09'));

// 무효 입력은 조용히 빈 값 — 화면이 죽으면 안 된다
ok('무효 ISO → 빈 문자열', kstStamp('not-a-date') === '', kstStamp('not-a-date'));
ok('null → 빈 문자열', kstStamp(null) === '', kstStamp(null));

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
