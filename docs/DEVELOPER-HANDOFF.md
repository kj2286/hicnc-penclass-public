# 외부 작업자 인계

## 먼저 확인할 사항

하이씨앤씨 펜클래스의 영어 수업용 소스입니다. PDF 업로드 → ncode PDF 다운로드 → 출력 → 스마트펜·크래들 수신 → 학생 필기 기록과 문항별 분석 흐름을 유지합니다.

이번 수정은 학생을 로그인 계정 없이 등록하는 기능입니다. 학생 추가 시 Auth 사용자를 만들지 않고 학생 기록을 저장합니다. 새 학생에게 로그인 아이디·비밀번호를 발급하거나 전달하지 않습니다. 화면에서 학생 기록을 구분하는 내부 UUID는 펜 배정과 필기 연결에 계속 필요합니다.

기존 학생의 UUID나 필기 경로를 바꾸지 마세요. 기존 Auth 사용자를 일괄 삭제하지 않습니다. 교사·관리자의 로그인과 빠르게 시작하기는 유지합니다.

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `src/app/teacher/pages/StudentsPage.tsx` | 학생 등록·목록·상세·퇴원·복귀 |
| `src/lib/api.ts` | 학생 기록 조회와 API 호출 |
| `api/create-student.ts` | 계정 없는 학생 등록 |
| `api/student-trash.ts` | 학생 수정·퇴원·복귀·영구삭제 |
| `supabase/029_student_records_without_auth.sql` | 학생 기록과 로그인 연결 분리 |
| `supabase/HICNC_FRESH_INSTALL.sql` | 빈 Supabase 프로젝트의 신규 설치 |
| `src/app/teacher/pages/PapersPage.tsx` | PDF 교재 작업 |
| `src/app/teacher/pages/ReviewPage.tsx` | 문항별 필기와 분석 |
| `src/app/teacher/pages/ReportPage.tsx` | 학습 리포트 |
| `desktop/` | Tauri PC 앱과 네이티브 연결 |

## 실행과 검증

Node.js 24에서 `npm ci`, `npm run build`, `npm test`, `npm run test:desktop`을 실행합니다. `npm run dev`는 화면 개발용이며 전체 서버 API를 대신하지 않습니다. 환경변수 이름과 네이티브 빌드 조건은 [SETUP.md](SETUP.md)에 있습니다.

학생 등록의 서버 검사는 가상 응답으로 권한·성공·실패와 Auth 미생성을 확인합니다. DB SQL의 정적 검사와 검토는 실제 Supabase에 적용한 결과가 아닙니다. 운영 연결이 필요한 검증을 로컬 단위 검사 통과로 대신하지 마세요.

## 서버에 반영할 때

변경 SQL을 먼저 읽고 대상 DB의 스키마와 백업을 확인합니다. 기존 DB에는 `029_student_records_without_auth.sql`을 적용합니다. 완전히 빈 새 프로젝트에는 `HICNC_FRESH_INSTALL.sql`을 실행한 뒤 029 파일도 적용해야 합니다. 기존 DB에 신규 설치 파일을 실행하면 안 됩니다.

학생 기록을 저장하는 새 API보다 DB 변경을 먼저 적용해야 합니다. 변경을 적용하지 않은 서버에서는 학생 등록이 실패할 수 있습니다. 실패했다고 학생 Auth 계정을 대신 만드는 경로를 추가하지 마세요.

실제 DB 변경은 실행할 SQL과 영향 범위를 담당자에게 보여주고 승인받은 뒤 진행합니다. 이 저장소를 전달하면서 운영 DB를 바꾸거나 서버를 배포하지 않았습니다.

## 공개본에서 빠진 자료

비공개 펜 SDK, 실제 필기 캡처, 사용자 데이터, 서버 비밀키, 교육청·교재 원문은 포함하지 않습니다. PC 앱의 네이티브 빌드와 실제 ncode·AI 연동에는 담당자가 별도로 제공하는 SDK 및 서버 접근 권한이 필요합니다.

사용자 요청에 따라 이번 작업에서는 설치 프로그램 ZIP을 만들지 않습니다. 소스 수정·검증·인계 문서에 집중합니다. Windows·Mac 실기기와 실제 펜·크래들 검증 여부는 코드 빌드 결과와 나누어 기록하세요.
