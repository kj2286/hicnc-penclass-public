# 외부 구성 요소 고지

기존 구성 요소의 라이선스와 저작권 고지를 보존합니다. 공개 저장소에 별도의 MIT 등 프로젝트 전체 라이선스를 새로 적용하지 않았습니다.

| 구성 요소 | 확인한 버전 | 패키지의 라이선스 표기 | 고지 파일 |
| --- | --- | --- | --- |
| web_pen_sdk | 0.8.0 | GPL-3.0-only | [LICENSE](licenses/web_pen_sdk-LICENSE.txt) |
| @seed-design/css | 2.3.0 | Apache-2.0 | [LICENSE](licenses/seed-css-LICENSE), [NOTICE](licenses/seed-css-NOTICE) |
| @seed-design/react | 2.1.0 | Apache-2.0 | [LICENSE](licenses/seed-react-LICENSE), [NOTICE](licenses/seed-react-NOTICE) |
| @karrotmarket/react-monochrome-icon | 1.25.0 | Apache-2.0 | [LICENSE](licenses/karrot-icon-LICENSE), [NOTICE](licenses/karrot-icon-NOTICE) |
| Inter | 포함된 폰트 | SIL Open Font License | [OFL](public/fonts/Inter-OFL.txt) |
| Pretendard | 포함된 폰트 | SIL Open Font License | [OFL](public/fonts/Pretendard-OFL.txt) |

웹 코드는 `web_pen_sdk`를 직접 사용합니다. 해당 의존성은 위 GPL-3.0-only 조건을 따릅니다. 전체 npm 의존성의 고정 버전과 라이선스 표기는 `package-lock.json`에서 확인할 수 있습니다. 이 표는 전체 의존성의 라이선스를 대체하지 않습니다.

네이티브 펜 SDK 두 crate는 별도 비공개 구성 요소로 공개본에서 제외했습니다. `desktop/Cargo.toml`의 기존 `UNLICENSED` 표기를 유지하며, 공개 소스에 SDK 사용·복제 권한을 새로 부여하지 않습니다. 브랜드 이미지와 로고에도 별도 이용 허가를 추가하지 않았습니다.
