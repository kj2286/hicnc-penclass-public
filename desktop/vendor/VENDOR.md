# 장치 SDK 의존성

이 공개 저장소에는 장치 SDK의 소스와 실기기 캡처 파일을 포함하지 않습니다. 공개 재배포 근거를 확인하지 못했기 때문입니다.

Windows/macOS 네이티브 프로그램을 소스에서 빌드하려면 공급사에서 사용 권한을 받은 다음 두 Rust 크레이트를 준비해야 합니다.

- `desktop/vendor/postdemy-pen-core/Cargo.toml`
- `desktop/vendor/postdemy-pen-desktop/Cargo.toml`

각 디렉터리에는 해당 크레이트의 소스가 함께 있어야 합니다. `desktop/Cargo.toml`과 `desktop/desk-core/Cargo.toml`이 이 경로를 참조합니다. 비공개 SDK를 공개 저장소에 커밋하지 마세요.

SDK가 없으면 `npm run desktop:build`를 완료할 수 없습니다. 웹 화면 빌드와 공개본 오프라인 테스트는 이 SDK 없이 실행할 수 있습니다. `npm run test:desktop`은 연결 경로와 명령/권한 구성을 검사하며 네이티브 컴파일이나 실기기 작동을 검증하지 않습니다.

SDK의 라이선스와 재배포 조건은 공급사와 별도로 확인해야 합니다. 이 문서는 사용 허가를 부여하지 않습니다.
