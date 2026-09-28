//! **블루투스로 펜 하나를 직접 연결해 필기를 가져온다** — 크래들 없이.
//!
//! 사용자 요구(2026-08-17): "크래들 연결 없이도 학생관리에서 직접 펜 연결하기 버튼 →
//! 거기서 펜 연결해서 데이터 들고올 수 있게." PC 프로그램에서 쓴다고 확정됐다.
//! 브라우저 Web Bluetooth 는 Tauri 웹뷰가 지원하지 않으므로 **네이티브가 유일한 길**이다.
//!
//! 프로토콜은 새로 짜지 않는다 — SDK(`postdemy-pen-desktop`)의 `BleSession` 이
//! 스캔·연결·인증·오프라인 다운로드를 이미 다 한다. 여기서는 그것을 크래들 경로와
//! **같은 모양**(`PullWeb`)으로 감싸기만 한다. 웹 화면이 두 경로를 구분할 필요가 없다.
//!
//! 🚨 **읽기 전용이다.** `Safety::ReadOnly` + `DownloadOptions::keeping` 으로
//! 펜에서 데이터를 지우지 않는다. BLE 는 크래들과 달리 도중에 끊기기 쉬워서,
//! "받고 지우기" 를 켰다가 중간에 끊기면 학생 필기가 영구히 사라진다.

use postdemy_pen_core::offline::PRESSURELESS_PRESSURE;
use postdemy_pen_desktop::ble_offline::DownloadOptions;
use postdemy_pen_desktop::ble_session::BleSession;
use postdemy_pen_desktop::ble_transport::{BleTransport, Target};
use postdemy_pen_desktop::download::Flow;
use postdemy_pen_desktop::Safety;
use serde::Serialize;
use std::time::Duration;

use crate::cradle::PullWeb;

/// 스캔에 잡힌 펜 한 자루 — 화면의 목록 한 줄.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlePenAd {
    /// 연결할 때 그대로 되돌려줄 값. **이름이 아니라 이것으로 고른다** —
    /// 공장 기본 이름은 여러 펜이 공유해서 이름으로는 개체를 못 가린다.
    pub id: String,
    pub name: String,
    /// 신호 세기(dBm). 못 읽으면 없음 — 가까운 순 정렬에만 쓴다.
    pub rssi: Option<i16>,
}

/// 주변 펜 목록. 펜이 꺼져 있거나 다른 기기에 물려 있으면 안 잡힌다.
pub fn scan(secs: u64) -> Result<Vec<BlePenAd>, String> {
    let found = BleTransport::scan(Duration::from_secs(secs.clamp(2, 20)))
        .map_err(|e| format!("BLE 스캔 실패 — 블루투스가 켜져 있는지, 권한이 있는지 확인하세요: {e}"))?;
    let mut out: Vec<BlePenAd> = found
        .into_iter()
        .map(|a| BlePenAd { id: a.id, name: a.name, rssi: a.rssi })
        .collect();
    // 가까운 것부터 — 신호를 못 읽은 것은 뒤로.
    out.sort_by(|a, b| b.rssi.unwrap_or(i16::MIN).cmp(&a.rssi.unwrap_or(i16::MIN)));
    Ok(out)
}

/// 펜에 저장된 **모든** 오프라인 노트를 받아 웹 형식 획으로 돌려준다.
///
/// 업로드·(학생,날짜) 병합은 크래들 경로와 마찬가지로 **웹 화면이** 한다.
pub fn pull_web(id: &str, label: &str) -> Result<PullWeb, String> {
    let mut session = BleSession::open(&Target::Id(id.to_string()), Safety::ReadOnly)
        .map_err(|e| format!("펜 연결 실패 — 펜 전원과 거리를 확인하세요: {e}"))?;

    // 🕐 **펜 시계 교정** — 실사고(2026-08-17): 펜 RTC 가 하루 늦어 오늘 필기가
    // 어제 날짜로 기록됐다. 붙을 때마다 PC 시각으로 맞춰 재발을 원천 차단한다.
    // 실패해도 수거는 계속한다 — 교정은 다음 필기부터의 예방이지 전제가 아니다.
    let _ = session.set(&postdemy_pen_core::ble::command::PenSetting::CurrentTime(
        chrono::Utc::now().timestamp_millis(),
    ));

    let notes = session
        .offline_notes()
        .map_err(|e| format!("펜의 필기 목록을 읽지 못했습니다: {e}"))?;
    if notes.is_empty() {
        return Err("이 펜에는 저장된 필기가 없습니다.".into());
    }

    // 지우지 않는다 — 중간에 끊겨도 학생 필기가 남아 있어야 한다.
    let opts = DownloadOptions::keeping(PRESSURELESS_PRESSURE);
    let mut strokes = Vec::new();
    let mut note_pairs = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for note in notes {
        let pages = match session.offline_pages(note) {
            Ok(p) if !p.is_empty() => p,
            // 페이지 목록이 비었거나 못 읽은 노트는 **건너뛰되 조용히 넘기지 않는다** —
            // 일부만 받아 놓고 "다 받았다" 고 보고하면 유실을 못 알아챈다.
            Ok(_) => continue,
            Err(e) => {
                failures.push(format!("노트 {} 페이지 목록: {e}", note.note_id));
                continue;
            }
        };
        match session.download_offline(note, &pages, &opts, &mut |_| Flow::Continue) {
            Ok(dl) => {
                note_pairs += 1;
                strokes.extend(dl.file.strokes);
            }
            Err(e) => failures.push(format!("노트 {}: {e}", note.note_id)),
        }
    }

    if strokes.is_empty() {
        return Err(if failures.is_empty() {
            "펜에서 받은 필기가 비어 있습니다.".into()
        } else {
            format!("펜에서 필기를 받지 못했습니다 — {}", failures.join(" / "))
        });
    }

    let now = chrono::Local::now();
    let dir = crate::cradle::receive_dir(&now.format("%Y-%m-%d").to_string(), label);
    let web = crate::webfmt::to_web_strokes(&strokes, chrono::Utc::now().timestamp_millis());
    Ok(PullWeb {
        strokes: web,
        note_pairs,
        // 일부 노트가 실패했으면 사용자가 알아야 한다 — 화면이 이 수를 보고 경고한다.
        skipped_records: failures.len(),
        raw_dir: dir.display().to_string(),
    })
}
