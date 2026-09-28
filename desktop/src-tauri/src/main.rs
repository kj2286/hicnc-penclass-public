//! 하이씨앤씨 펜클래스 — Tauri 셸.
//!
//! 메인 창은 하이씨앤씨 운영 웹의 PDF 교재 화면을 연다.
//! 원본처럼 웹과 API는 같은 서버를 쓰고, 스마트펜·인쇄·PDF 저장은 네이티브로 연결한다.
//! 웹이 못 하는 크래들 USB·펜 BLE 만 아래 커맨드로 노출하고, 웹의
//! "크래들 (PC)" 페이지(`/t/desk`)가 `window.__TAURI__` 로 호출한다.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use desk_core::cradle::{self, CradleView, ProbeInfo, PullWeb};
use tauri::Manager;

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => Err(format!("작업 스레드 오류: {e}")),
    }
}

/// 크래들·슬롯 발견 (포트 안 엶 — 폴링 안전).
#[tauri::command]
async fn cradle_snapshot() -> Result<Vec<CradleView>, String> {
    blocking(cradle::snapshot).await
}

/// 슬롯 상세 (READ ONLY 세션) — 모델·FW·전체 MAC·저장소·파일 수.
#[tauri::command]
async fn cradle_probe(port: String) -> Result<ProbeInfo, String> {
    blocking(move || cradle::probe(&port)).await
}

/// 슬롯 오프라인 필기 수신 — 원본은 문서 폴더에 덤프, 웹 호환 스트로크 반환.
/// 업로드·(학생,날짜) 병합은 웹 화면이 자기 로직으로 한다.
#[tauri::command]
async fn cradle_pull(port: String, slot: u8, label: String) -> Result<PullWeb, String> {
    blocking(move || cradle::pull_web(&port, slot, &label)).await
}

/// 슬롯 펜의 오프라인 필기 파일 전체 삭제 — 되돌릴 수 없다.
/// 확인 다이얼로그는 웹 화면 책임 — 여기서는 묻지 않고 바로 지운다.
#[tauri::command]
async fn cradle_erase(port: String) -> Result<cradle::EraseOutcome, String> {
    blocking(move || cradle::erase(&port)).await
}

/// 주변 블루투스 펜 목록 — 크래들 없이 펜을 고르기 위한 첫 단계.
#[tauri::command]
async fn ble_scan_pens(secs: Option<u64>) -> Result<Vec<desk_core::ble_pen::BlePenAd>, String> {
    let secs = secs.unwrap_or(6);
    blocking(move || desk_core::ble_pen::scan(secs)).await
}

/// 블루투스로 붙은 펜에서 오프라인 필기 수신 — **펜의 데이터는 지우지 않는다**.
/// 크래들 경로와 같은 `PullWeb` 을 돌려주므로 웹 화면 로직은 동일하다.
#[tauri::command]
async fn ble_pull_pen(id: String, label: String) -> Result<PullWeb, String> {
    blocking(move || desk_core::ble_pen::pull_web(&id, &label)).await
}

/// 실시간 교실 모드 시작 — 획이 완성될 때마다 `pen-live-stroke` 이벤트를 쏜다.
/// 연결 실패는 **여기서** 에러로 돌려준다(백그라운드로 던지면 화면이 영영 기다린다).
#[tauri::command]
async fn ble_live_start(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use tauri::Emitter;
    let pen_id = id.clone();
    blocking(move || {
        desk_core::ble_live::start(&id, move |stroke| {
            let _ = app.emit(
                "pen-live-stroke",
                serde_json::json!({ "penId": pen_id, "stroke": stroke }),
            );
        })
    })
    .await
}

/// **배정된 MAC 으로** 실시간 시작 — 선생님이 학생 관리에서 이미 배정했으므로
/// 라이브에서 다시 고르게 하지 않는다. 스토어 키도 MAC 이라 배정이 그대로 붙는다.
#[tauri::command]
async fn ble_live_start_mac(app: tauri::AppHandle, mac: String) -> Result<(), String> {
    use tauri::Emitter;
    let key = mac.clone();
    blocking(move || {
        desk_core::ble_live::start_by_mac(&mac, move |stroke| {
            let _ = app.emit(
                "pen-live-stroke",
                serde_json::json!({ "penId": key, "stroke": stroke }),
            );
        })
    })
    .await
}

/// 실시간 수신 중단. 없는 펜을 넘겨도 안전하다.
#[tauri::command]
async fn ble_live_stop(id: Option<String>) -> Result<(), String> {
    blocking(move || {
        match id {
            Some(i) => desk_core::ble_live::stop(&i),
            None => desk_core::ble_live::stop_all(),
        }
        Ok(())
    })
    .await
}

/// 지금 실시간으로 붙어 있는 펜 목록 — 화면 복귀 시 상태 복원용.
#[tauri::command]
async fn ble_live_active() -> Result<Vec<String>, String> {
    Ok(desk_core::ble_live::active())
}

/// BLE 로 펜 BT 이름 변경 (0x0C). 비밀번호는 "0000"→"" 각 1회만 시도.
#[tauri::command]
async fn ble_rename(mac_suffix: String, new_name: String) -> Result<String, String> {
    desk_core::ble::rename(mac_suffix, new_name).await
}

/// 리포트 [PDF 저장] — WKWebView 는 `window.print()` 를 지원하지 않아 웹의
/// 인쇄 버튼이 맥 앱에서 **조용히 아무것도 안 했다**(2026-08-19 사용자 신고:
/// "분석리포트 PDF 다운로드가 안 된다"). 네이티브 인쇄 다이얼로그를 연다 —
/// 사용자는 다이얼로그에서 [PDF 로 저장]을 고르면 된다.
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

/// ncode PDF **바로 출력** (2026-09-03) — 웹 교재 만들기의 [바로 출력].
/// 네트워크(mDNS)에서 IPP 프린터를 찾는다. 못 찾으면 빈 목록(화면에서 주소 직접 입력).
#[tauri::command]
async fn print_discover(secs: Option<u64>) -> Result<Vec<desk_core::print::Printer>, String> {
    blocking(move || Ok(desk_core::print::discover(secs.unwrap_or(5)))).await
}

/// **OS 에 등록된 프린터** 목록 (0.2.29). mDNS 가 막힌 망에서 두 번째 길이다 —
/// 사용자 요구 2026-09-04: "프린터 찾는 방식은 OS 방식 그대로 차용하면 돼".
/// USB·WSD 처럼 직접 Print-Job 을 못 던지는 큐는 uri 가 빈 문자열로 온다.
#[tauri::command]
async fn print_system_printers() -> Result<Vec<desk_core::print::SystemPrinter>, String> {
    blocking(desk_core::print::system_printers).await
}

/// 프린터 능력 조회 — 1200dpi·PDF 지원 여부를 출력 전에 보여준다.
#[tauri::command]
async fn print_probe(uri: String) -> Result<desk_core::print::PrinterInfo, String> {
    blocking(move || desk_core::print::probe(&uri)).await
}

/// 출력 목록에서 프린터의 실제 작업 상태를 조회한다.
#[tauri::command]
async fn print_job_status(uri: String, job_id: i32) -> Result<desk_core::print::JobStatus, String> {
    blocking(move || desk_core::print::job_status(&uri, job_id)).await
}

/// ncode PDF 를 내려받아 IPP 로 직접 출력하고, 프린터가 기록한 해상도를 검증해 돌려준다.
#[tauri::command]
async fn print_ncode(
    url: String,
    uri: String,
    dpi: i32,
    copies: Option<i32>,
    job_name: Option<String>,
) -> Result<desk_core::print::PrintResult, String> {
    blocking(move || {
        let pdf = desk_core::print::download(&url)?;
        desk_core::print::print_pdf(
            &uri,
            pdf,
            dpi,
            copies.unwrap_or(1),
            job_name.as_deref().unwrap_or("ncode"),
        )
    })
    .await
}

/// 리포트 PDF(base64)를 **다운로드 폴더에 저장**하고 파인더/탐색기에서
/// 보여준다. 웹뷰는 `<a download>` 를 처리하지 않아 파일 저장 경로가 없었다
/// (2026-08-19 사용자: "보이는 리포트를 pdf 로 저장할 수 있어야 해").
#[tauri::command]
fn save_pdf(app: tauri::AppHandle, file_name: String, base64: String) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.as_bytes())
        .map_err(|e| format!("PDF 데이터 해석 실패: {e}"))?;
    let dir = app.path().download_dir().map_err(|e| format!("다운로드 폴더를 찾지 못했습니다: {e}"))?;
    let path = write_pdf_file(&dir, &file_name, &bytes)?;
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(&path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn();
    }
    Ok(path.display().to_string())
}

fn write_pdf_file(dir: &std::path::Path, file_name: &str, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    use std::io::Write;
    if !bytes.starts_with(b"%PDF-") {
        return Err("올바른 PDF 데이터가 아닙니다. 다시 만들어 주세요.".to_string());
    }
    let stem = pdf_file_stem(file_name);
    let safe = format!("{stem}.pdf");
    std::fs::create_dir_all(dir).map_err(|e| format!("다운로드 폴더를 만들지 못했습니다: {e}"))?;
    for n in 0..10000 {
        let path = dir.join(if n == 0 { safe.clone() } else { format!("{stem} ({n}).pdf") });
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    drop(file);
                    let _ = std::fs::remove_file(&path);
                    return Err(format!("PDF 저장 실패: {error}"));
                }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("PDF 저장 실패: {error}")),
        }
    }
    Err("같은 이름의 PDF가 너무 많습니다. 교재 이름을 바꿔 주세요.".to_string())
}

fn pdf_file_stem(file_name: &str) -> String {
    // 경로 문자·제어문자, Windows 예약명, macOS UTF-8 파일명 제한을 함께 처리한다.
    let safe: String = file_name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
                || c.is_control()
            {
                '_'
            } else {
                c
            }
        })
        .collect();
    let mut safe = safe.trim().trim_end_matches('.').to_string();
    if safe.to_ascii_lowercase().ends_with(".pdf") { safe.truncate(safe.len() - 4); }
    let mut stem = safe.trim().trim_end_matches('.').to_string();
    if stem.is_empty() { stem = "학습분석리포트".to_string(); }
    let first = stem.split('.').next().unwrap_or_default().trim().to_ascii_uppercase();
    let port_name = first.strip_prefix("COM").or_else(|| first.strip_prefix("LPT"))
        .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"));
    if matches!(first.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") || port_name {
        stem.insert(0, '_');
    }
    // 확장자와 동명 파일의 번호를 붙여도 255바이트를 넘지 않도록 여유를 둔다.
    let mut limit = stem.len().min(200);
    while !stem.is_char_boundary(limit) { limit -= 1; }
    stem.truncate(limit);
    stem.trim_end().trim_end_matches('.').to_string()
}

#[cfg(test)]
mod pdf_tests {
    use super::{pdf_file_stem, write_pdf_file};

    #[test]
    fn native_pdf_file_names_support_korean_and_windows_reserved_names() {
        let long = pdf_file_stem(&format!("{}.pdf", "가".repeat(90)));
        assert_eq!(long.chars().count(), 66);
        assert!(long.len() <= 200);
        for name in ["CON.pdf", "prn.PDF", "AUX.pdf", "NUL.backup.pdf", "COM1.pdf", "lpt9.pdf", "COM¹.pdf"] {
            assert!(pdf_file_stem(name).starts_with('_'), "{name}");
        }
        assert_eq!(pdf_file_stem("  .pdf  "), "학습분석리포트");
        assert_eq!(pdf_file_stem("영어 수업.PDF"), "영어 수업");
        assert_eq!(pdf_file_stem("COM10.pdf"), "COM10");
    }

    #[test]
    fn native_pdf_save_preserves_existing_files_and_stays_in_download_dir() -> Result<(), String> {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?.as_nanos();
        let dir = std::env::temp_dir().join(format!("hicnc-pdf-test-{}-{stamp}", std::process::id()));
        let first = write_pdf_file(&dir, "../영어:교재.pdf", b"%PDF-1.4\nfirst")?;
        let second = write_pdf_file(&dir, "../영어:교재.pdf", b"%PDF-1.4\nsecond")?;
        assert_eq!(first.parent(), Some(dir.as_path()));
        assert_eq!(second.parent(), Some(dir.as_path()));
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).map_err(|e| e.to_string())?, b"%PDF-1.4\nfirst");
        assert_eq!(std::fs::read(&second).map_err(|e| e.to_string())?, b"%PDF-1.4\nsecond");
        let long = write_pdf_file(&dir, &format!("{}.pdf", "가".repeat(90)), b"%PDF-1.4\nlong")?;
        assert!(long.file_name().is_some_and(|name| name.to_string_lossy().len() < 255));
        let reserved = write_pdf_file(&dir, "CON.pdf", b"%PDF-1.4\nreserved")?;
        assert_eq!(reserved.file_name().and_then(|name| name.to_str()), Some("_CON.pdf"));
        assert!(write_pdf_file(&dir, "invalid.pdf", b"not a PDF").is_err());
        assert!(!dir.join("invalid.pdf").exists());
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// 오늘 수신 폴더를 파인더/탐색기로 연다.
#[tauri::command]
fn open_receive_dir() -> Result<String, String> {
    let dir = cradle::receive_dir(&chrono::Local::now().format("%Y-%m-%d").to_string(), "");
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(target_os = "windows")]
    let r = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let r: std::io::Result<std::process::Child> =
        Err(std::io::Error::other("지원하지 않는 OS"));
    r.map_err(|e| e.to_string())?;
    Ok(dir.display().to_string())
}

/// 자동 업데이트 — 시작 직후 백그라운드로 latest.json 확인.
/// 학원 로고를 앱 아이콘으로 적용 (B2B 화이트라벨).
///
/// 웹에서 로고 PNG 바이트를 그대로 넘겨준다. 창·작업표시줄 아이콘을 바로 바꾸고,
/// 윈도우에서는 바탕화면·시작메뉴 바로가기 아이콘까지 다시 지정한다.
/// (설치파일·응용프로그램 폴더 아이콘은 빌드 시 고정이라 못 바꾼다 — brand.rs 참고)
#[tauri::command]
async fn apply_brand_icon(window: tauri::WebviewWindow, png: Vec<u8>) -> Result<(), String> {
    let bytes = png.clone();
    blocking(move || desk_core::brand::apply_brand_icon(&bytes).map(|_| ())).await?;
    set_window_icon(&window, &png)
}

/// 브랜딩 해제 — 기본 아이콘으로. (로그아웃·학원 로고 삭제 시)
#[tauri::command]
async fn clear_brand_icon() -> Result<(), String> {
    blocking(desk_core::brand::clear_brand_icon).await
}

/// 창(작업표시줄) 아이콘 교체. 실패해도 앱은 계속 쓸 수 있어야 하므로
/// 메시지만 올린다.
fn set_window_icon(window: &tauri::WebviewWindow, png: &[u8]) -> Result<(), String> {
    let img = tauri::image::Image::from_bytes(png)
        .map_err(|e| format!("아이콘 이미지를 읽지 못했습니다: {e}"))?;
    window
        .set_icon(img)
        .map_err(|e| format!("창 아이콘 변경 실패: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            cradle_snapshot,
            cradle_probe,
            cradle_pull,
            ble_scan_pens,
            ble_pull_pen,
            ble_live_start,
            ble_live_start_mac,
            ble_live_stop,
            ble_live_active,
            cradle_erase,
            ble_rename,
            print_page,
            print_discover,
            print_system_printers,
            print_probe,
            print_ncode,
            print_job_status,
            save_pdf,
            open_receive_dir,
            apply_brand_icon,
            clear_brand_icon
        ])
        .setup(|app| {
            // 창 제목에 **실행 시점의 실제 버전**을 붙인다. 예전에는 설정 파일에
            // 버전을 하드코딩했다가 실제 버전과 어긋나는 사고(0.2.10 표시)가 있어
            // 뺐는데, 버전이 아예 안 보이니 "지금 어떤 빌드인가" 를 알 수 없었다
            // (2026-08-17 — 하루 종일 이 혼란으로 옛 빌드를 설치하는 사고 반복).
            // 런타임에 읽으면 어긋날 수가 없다.
            if let Some(w) = app.get_webview_window("main") {
                let v = app.package_info().version.to_string();
                let _ = w.set_title(&format!("하이씨앤씨 펜클래스 v{v}"));
            }

            // 지난번에 적용해 둔 학원 아이콘 복원 — 껐다 켜도 유지되어야 한다
            if let (Some(p), Some(w)) = (
                desk_core::brand::saved_brand_icon(),
                app.get_webview_window("main"),
            ) {
                match std::fs::read(&p).map_err(|e| e.to_string()) {
                    Ok(bytes) => {
                        if let Err(e) = set_window_icon(&w, &bytes) {
                            eprintln!("학원 아이콘 복원 실패(무시): {e}");
                        }
                    }
                    Err(e) => eprintln!("학원 아이콘 읽기 실패(무시): {e}"),
                }
            }
            // 별도 배포 주소와 서명 키를 정하기 전까지 자동 업데이트는 연결하지 않는다.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("앱 실행 실패");
}
