# 개발 환경 안내

## 웹 화면과 서버

Node.js 24에서 `npm ci`로 의존성을 설치합니다. `.env.example`을 참고해 자신의 환경변수를 `.env.local`에 설정하세요. 환경변수를 비운 상태에서도 `npm run build`로 소스를 빌드할 수 있습니다.

브라우저에는 Supabase 공개 URL과 공개 키만 전달합니다. `SUPABASE_SERVICE_ROLE_KEY`, `NGS_AUTH`, AI API 키는 서버 환경변수로만 설정하세요. 서버 비밀값에 `VITE_` 접두어를 붙이면 안 됩니다.

이 프로젝트의 `/api/*`는 Vercel 함수입니다. Vite 개발 서버에는 전체 API가 없으므로 `npm run dev`는 화면 개발에 사용합니다. 독립 운영에는 본인의 Vercel 프로젝트, Supabase DB·스토리지, NGS/FPS 서비스 접근 권한이 필요합니다. `.env.example`에 설정 이름을 정리했습니다.

`supabase/`의 SQL은 스키마 소스입니다. 기존 DB에는 `029_student_records_without_auth.sql`을 적용합니다. 빈 새 Supabase 프로젝트에는 `HICNC_FRESH_INSTALL.sql`을 실행한 다음 `029_student_records_without_auth.sql`을 적용해야 합니다. 신규 설치 파일은 기존 DB에 덮어쓰는 업그레이드 파일이 아닙니다. 이번 소스 전달에서는 DB를 생성하거나 변경하지 않았습니다.

학생에게는 로그인 계정이나 비밀번호를 발급하지 않습니다. 교사 임시 비밀번호는 발급할 때마다 새 값으로 생성합니다. 독립 서버를 운영하기 전에는 교사 비밀번호 전달 방식과 빠르게 시작하기의 계정 생성·사용량 제한을 검토하세요. 운영 서비스의 계정이나 데이터는 복사하지 않습니다.

## PC 앱

PC 앱은 Tauri 2와 Rust로 작성했습니다. `desktop/`만 따로 복사하면 상위 스크립트가 없어 빌드되지 않습니다.

공개본에는 별도 비공개 SDK의 소스가 없습니다. 사용 권한이 있는 SDK를 아래 두 경로에 준비해야 합니다.

```text
desktop/vendor/postdemy-pen-core/
desktop/vendor/postdemy-pen-desktop/
```

각 폴더에는 해당 crate의 `Cargo.toml`과 `src/`가 필요합니다. SDK를 준비한 뒤 Rust 1.90 이상과 Tauri CLI 2.11.4를 설치합니다.

```sh
cargo install tauri-cli --version 2.11.4 --locked
npm run test:desktop
npm run desktop:build -- --bundles nsis
```

Windows 빌드에는 Visual Studio C++ 빌드 도구와 Windows SDK가 필요합니다. macOS 공용 빌드는 macOS에서 Xcode 명령줄 도구를 설치한 뒤 실행합니다.

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run desktop:build -- --target universal-apple-darwin --bundles app,dmg
```

설치본은 `https://hicnc-penclass.vercel.app/t/papers`에 연결합니다. 자신의 서버용 앱을 만들 때는 `desktop/src-tauri/tauri.conf.json`의 창 URL과 `capabilities/main.json`의 허용 출처를 함께 바꾸고, `scripts/desktop-test.ts`의 주소 검사도 맞추세요. 현재 앱은 자동 업데이트를 사용하지 않습니다.

## 공개본의 차이

교육청 평가자료와 별도 교재의 원문은 공개 재배포 근거를 확인하지 못해 제외했습니다. `api/data/`에는 빈 데이터만 담았으며, 원문을 사용하는 테스트도 공개 테스트 목록에서 제외합니다. 자료가 없을 때의 처리와 나머지 테스트를 확인합니다.

공개 소스에서는 교사 임시 비밀번호의 고정값을 없애고, 개발용 PDF 중계 설정도 서버 전용 `NGS_BASE_URL`·`NGS_AUTH`로 통일했습니다. 기존 운영 서버를 변경하거나 재배포하지 않았습니다.

비공개 SDK를 제외했으므로 이 공개 저장소만으로 네이티브 앱 전체를 다시 빌드할 수는 없습니다. 이번 전달물은 소스이며 설치 프로그램 ZIP은 만들지 않습니다.
