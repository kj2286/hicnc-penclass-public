import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const command = process.argv[2];
if (!['dev', 'build', 'info'].includes(command)) {
  throw new Error('사용법: node scripts/desktop.mjs <dev|build|info> [Tauri 옵션]');
}
const child = spawn('cargo', ['tauri', command, ...process.argv.slice(3)], {
  cwd: fileURLToPath(new URL('../desktop', import.meta.url)),
  stdio: 'inherit',
});
child.on('error', error => {
  console.error(`PC 앱 도구를 실행하지 못했습니다. Rust와 Tauri CLI 설치를 확인해 주세요. ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', code => { process.exitCode = code ?? 1; });
