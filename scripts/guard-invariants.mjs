/**
 * 코드 불변 규칙 가드 — `npm test` 에서 실행된다.
 *
 * 1) 학생 필기 기록(sp_submissions) 삭제는 **api.ts 의 deleteSubmission 하나**로만.
 *    - 2026-08-13 원래 규칙: 삭제 코드 전면 금지. 크래들의 [펜 데이터 삭제]가
 *      서버 기록까지 지우는 사고를 막기 위해서였다.
 *    - 2026-08-17 정책 변경(사용자 요구): 학생 관리 > 필기 기록에서 선생님이
 *      **명시적으로** 지울 수 있어야 한다. 원래 의도는 "크래들과 비연동"이지
 *      "삭제 기능 금지"가 아니므로, 규칙을 이렇게 좁힌다:
 *      (a) sp_submissions .delete 체인은 api.ts 밖에 있으면 실패.
 *      (b) 크래들 화면(DeskCradlePage)·크래들 저장 경로(classroom-save)가
 *          deleteSubmission 을 부르면 실패 — 펜 삭제와 서버 기록은 여전히 비연동.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'api'];
const EXT = /\.(ts|tsx)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

const files = ROOTS.flatMap((r) => {
  try {
    return walk(r);
  } catch {
    return [];
  }
});

const FORBIDDEN = [
  {
    // createdAt/generatedAt/at 등 ISO 문자열을 slice 로 잘라 날짜 표기 금지 —
    // ISO 는 UTC 라 한국 자정 이후 하루 어긋난다(2026-08-18 리포트 실사고).
    // kstShortDate/kstDateKey/kstStamp 를 쓸 것.
    re: /At\.slice\(\s*[02]\s*,\s*10\s*\)|toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/,
    why: 'ISO 문자열 slice 날짜 표기 금지 — UTC 라 한국 자정 이후 하루 어긋납니다. kst.ts 헬퍼를 쓰세요.',
  },
  {
    // from('sp_submissions') … .delete(  — 같은 체인 안(세미콜론 전)에서만 매칭.
    // 유일한 관문은 api.ts 의 deleteSubmission 이다.
    re: /from\(\s*['"]sp_submissions['"]\s*\)[^;]*\.delete\s*\(/s,
    why: 'sp_submissions 삭제는 api.ts 의 deleteSubmission 로만 — 다른 곳에 두면 감사가 불가능합니다.',
    allowFiles: [/src\/lib\/api\.ts$/],
  },
  {
    // 크래들 경로는 서버 기록을 지우면 안 된다 (2026-08-13 사용자 명시 요구 유지)
    re: /deleteSubmission/,
    why: '크래들 경로는 서버 필기 기록과 비연동이어야 합니다 — deleteSubmission 호출 금지.',
    onlyFiles: [/DeskCradlePage\.tsx$/, /classroom-save\.ts$/],
  },
];

let failed = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const rule of FORBIDDEN) {
    if (rule.allowFiles?.some((re) => re.test(f))) continue;
    if (rule.onlyFiles && !rule.onlyFiles.some((re) => re.test(f))) continue;
    if (rule.re.test(src)) {
      console.error(`FAIL  ${f}\n      ${rule.why}`);
      failed += 1;
    }
  }
}

if (failed > 0) {
  console.error(`\n=== 불변 규칙 위반 ${failed}건 ===`);
  process.exit(1);
}
console.log(`PASS  불변 규칙 (검사 파일 ${files.length}개): 필기 기록 삭제 코드 없음`);
