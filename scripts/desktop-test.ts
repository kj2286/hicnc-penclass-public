import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
let passed = 0;
function test(name: string, check: () => void) { check(); passed++; console.log(`PASS ${name}`); }

const config = JSON.parse(read('desktop/src-tauri/tauri.conf.json'));
const permission = JSON.parse(read('desktop/src-tauri/capabilities/main.json'));

test('PC 앱은 PDF 교재와 처리 API를 같은 하이씨앤씨 서버에서 연다', () => {
  const target = new URL(config.app.windows[0].url);
  assert.equal(target.protocol, 'https:');
  assert.equal(target.hostname, 'hicnc-penclass.vercel.app');
  assert.equal(target.pathname, '/t/papers');
  assert.deepEqual(permission.remote.urls, [target.origin]);
  assert.equal(permission.local, false);
  assert.equal(config.identifier, 'com.hicnc.penclass');
  assert.equal(config.bundle.createUpdaterArtifacts, false);
  assert.equal(config.plugins.updater, undefined);
});

test('교재·필기·분석 서버 경로가 PC 앱 운영 출처와 연결된다', () => {
  assert.match(read('vercel.json'), /\/api\/ngs/);
  assert.match(read('src/lib/ngs-client.ts'), /\/api\/download-pdf/);
  assert.match(read('src/lib/api.ts'), /\/api\/ai/);
  assert.match(read('src/lib/strokes-io.ts'), /\/api\/strokes/);
  for (const path of ['api/ngs.ts', 'api/download-pdf.ts', 'api/ai.ts', 'api/strokes.ts']) {
    assert.ok(read(path).length > 500, path);
  }
});

test('웹이 호출하는 네이티브 명령은 앱 등록과 권한이 모두 있다', () => {
  const bridge = read('src/lib/desk.ts');
  const native = read('desktop/src-tauri/src/main.rs');
  const handler = native.match(/tauri::generate_handler!\[([\s\S]+?)\]/)?.[1] ?? '';
  const commands = [...bridge.matchAll(/\binvoke(?:<[^>]+>)?\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.ok(commands.length >= 20);
  for (const command of commands) {
    assert.match(handler, new RegExp(`\\b${command}\\b`), command);
    assert.ok(permission.permissions.includes(`allow-${command.replaceAll('_', '-')}`), command);
  }
});

test('제품 시작 경로는 고정 영어 샘플 대신 원본 교재 화면을 사용한다', () => {
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /EnglishWorkspace|englishPreview/);
  assert.match(app, /\/t\/papers/);
  assert.match(read('src/app/teacher/routes.tsx'), /PapersPage/);
  assert.match(read('src/app/teacher/pages/PapersPage.tsx'), /uploadPdf/);
});

console.log(`${passed} PASS / 0 FAIL (경로·명령 호환 검사, 실서버·실기기 검증 아님)`);
