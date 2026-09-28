import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 실제 교사 화면과 /api는 같은 운영 웹에서 실행한다. 비밀값과 샘플 화면은 포함하지 않는다.
const directory = fileURLToPath(new URL('../desktop/dist-shell/', import.meta.url));
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('../desktop/dist-shell/index.html', import.meta.url), `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>하이씨앤씨 펜클래스</title></head>
<body><main><h1>하이씨앤씨 펜클래스</h1><p>프로그램은 하이씨앤씨 서버에 연결해 교재와 학생 기록을 불러옵니다.</p><p>연결되지 않으면 인터넷 연결을 확인한 뒤 프로그램을 다시 열어 주세요.</p></main></body></html>`);
console.log('PC 앱 기본 리소스를 준비했습니다. 실제 화면은 하이씨앤씨 운영 웹을 사용합니다.');
