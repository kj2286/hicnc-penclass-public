//! **실시간 교실 모드** — 학생 펜이 PC 에 붙은 채로, 쓰는 즉시 화면에 나타난다.
//!
//! 사용자 요구(2026-08-17): "학생의 펜이 실시간으로 보여지지 않는데 구현해줘."
//!
//! # 왜 획 단위인가
//!
//! 펜은 도트를 하나씩 올리지만, 여기서는 **획이 끝날 때마다**(`StrokeCompleted`)
//! 웹으로 보낸다. 이유는 두 가지다.
//!  1. 도트 단위로 올리면 웹이 획을 다시 조립해야 하는데, 그 조립기는 이미
//!     코어에 있다 — 같은 것을 두 번 만들면 두 곳이 어긋난다.
//!  2. 변환기(`webfmt::to_web_strokes`)가 크래들·BLE 다운로드에서 이미 검증됐다.
//!     같은 형식으로 보내면 화면 코드가 경로를 구분할 필요가 없다.
//!
//! 획은 펜을 뗄 때 완성되므로 체감 지연은 획 하나 — 글씨가 한 획씩 나타난다.
//!
//! # 수명
//!
//! 세션은 **전용 스레드**가 소유한다. `BleSession` 은 `Send` 지만 블로킹이라
//! async 런타임에 올리면 워커를 잡아먹는다. 중단은 플래그로만 알린다 —
//! 스레드를 강제로 죽이면 BLE 핸들이 정리되지 않아 다음 연결이 실패한다.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use postdemy_pen_core::ink::StrokeAssembler;
use postdemy_pen_core::types::PenEvent;
use postdemy_pen_desktop::ble_session::{parse_mac, BleSession};
use postdemy_pen_desktop::ble_transport::Target;
use postdemy_pen_desktop::Safety;

use crate::webfmt::WebStroke;

/// 실행 중인 라이브 세션 하나. **펜 한 자루 = 스레드 하나.**
struct Live {
    pen_id: String,
    stop: Arc<AtomicBool>,
}

fn slot() -> &'static Mutex<Vec<Live>> {
    static S: OnceLock<Mutex<Vec<Live>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Vec::new()))
}

/// 지금 실시간으로 붙어 있는 펜 id 목록 — 화면이 연결 상태를 그린다.
pub fn active() -> Vec<String> {
    slot()
        .lock()
        .map(|v| v.iter().map(|l| l.pen_id.clone()).collect())
        .unwrap_or_default()
}

/// 실시간 수신을 멈춘다. 없는 펜을 넘겨도 조용히 통과한다(중복 호출 안전).
pub fn stop(pen_id: &str) {
    if let Ok(mut v) = slot().lock() {
        for l in v.iter().filter(|l| l.pen_id == pen_id) {
            l.stop.store(true, Ordering::Relaxed);
        }
        v.retain(|l| l.pen_id != pen_id);
    }
}

/// 전부 멈춘다 — 화면을 벗어나거나 앱을 닫을 때.
pub fn stop_all() {
    if let Ok(mut v) = slot().lock() {
        for l in v.iter() {
            l.stop.store(true, Ordering::Relaxed);
        }
        v.clear();
    }
}

/// **배정된 MAC 으로** 붙는다 — 선생님이 학생 관리에서 이미 펜을 배정했으므로
/// 라이브에서 다시 고르게 하면 안 된다(사용자 지적 2026-08-17).
///
/// BLE 광고에는 MAC 이 없다(macOS 는 주소를 숨긴다). SDK 는 후보를 하나씩 열어
/// 핸드셰이크로 MAC 을 확인하는 `open_by_mac` 을 제공한다 — 그걸 쓴다.
/// 키는 **MAC** 이다: 배정도 MAC 으로 걸려 있어야 카드에 학생 이름이 뜬다.
pub fn start_by_mac<F>(mac: &str, on_stroke: F) -> Result<(), String>
where
    F: FnMut(WebStroke) + Send + 'static,
{
    let bytes = parse_mac(mac)
        .ok_or_else(|| format!("펜 MAC 형식을 읽을 수 없습니다: {mac}"))?;
    start_inner(mac.to_string(), Opener::Mac(bytes), on_stroke)
}

/// 어떻게 펜을 찾을지 — 개체 id 로 직접, 또는 배정된 MAC 으로 대조.
enum Opener {
    Id(String),
    Mac([u8; 6]),
}

/// 펜에 붙어 실시간 수신을 시작한다. 획이 완성될 때마다 `on_stroke` 가 불린다.
///
/// 이미 붙어 있는 펜이면 아무것도 하지 않는다 — 두 번 붙으면 같은 획이 두 번 온다.
pub fn start<F>(pen_id: &str, on_stroke: F) -> Result<(), String>
where
    F: FnMut(WebStroke) + Send + 'static,
{
    start_inner(pen_id.to_string(), Opener::Id(pen_id.to_string()), on_stroke)
}

/// `key` 는 웹 스토어의 펜 식별자다 — 획도 배정도 이 키로 걸린다.
fn start_inner<F>(key: String, opener: Opener, mut on_stroke: F) -> Result<(), String>
where
    F: FnMut(WebStroke) + Send + 'static,
{
    if active().contains(&key) {
        return Ok(());
    }

    let stop_flag = Arc::new(AtomicBool::new(false));
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let id = key.clone();
    let flag = stop_flag.clone();

    std::thread::Builder::new()
        .name(format!("ble-live-{id}"))
        .spawn(move || {
            let opened = match opener {
                Opener::Id(i) => BleSession::open(&Target::Id(i), Safety::ReadOnly),
                Opener::Mac(m) => BleSession::open_by_mac(m, Safety::ReadOnly),
            }
                .map_err(|e| format!("펜 연결 실패 — 전원과 거리를 확인하세요: {e}"))
                .and_then(|mut s| {
                    // 🚨 이걸 안 부르면 도트가 **한 개도** 안 온다. 오류도 안 나서
                    // 원인을 찾기 어렵다 — SDK 주석이 같은 사고를 기록해 두었다.
                    s.start_realtime()
                        .map_err(|e| format!("실시간 구독 거부: {e}"))?;
                    // 펜 시계 교정 — 수거 경로와 같은 이유(RTC 하루 지연 실사고).
                    let _ = s.set(&postdemy_pen_core::ble::command::PenSetting::CurrentTime(
                        chrono::Utc::now().timestamp_millis(),
                    ));
                    Ok(s)
                });
            let mut session = match opened {
                Ok(s) => {
                    let _ = tx.send(Ok(()));
                    s
                }
                Err(e) => {
                    let _ = tx.send(Err(e));
                    return;
                }
            };

            // 🚨 파서는 Dot/PenDown/PenUp **원시 이벤트만** 올린다 — StrokeCompleted
            // 를 만드는 곳은 아무 데도 없다(2026-08-17 실사고: 그 이벤트만 기다리다
            // 획이 하나도 안 올라왔다). 조립은 여기서 StrokeAssembler 로 한다.
            let mut asm = StrokeAssembler::new();
            while !flag.load(Ordering::Relaxed) {
                // 짧게 끊어 기다린다 — 중단 요청에 빨리 반응해야 다음 연결이 막히지 않는다.
                match session.next_event(Duration::from_millis(250)) {
                    Some(PenEvent::PowerOff) => break,
                    Some(ev) => {
                        if let Some(stroke) = asm.process(&ev) {
                            let now = chrono::Utc::now().timestamp_millis();
                            for w in
                                crate::webfmt::to_web_strokes(std::slice::from_ref(&stroke), now)
                            {
                                on_stroke(w);
                            }
                        }
                    }
                    None => {}
                }
            }
        })
        .map_err(|e| format!("실시간 스레드를 만들지 못했습니다: {e}"))?;

    // 연결 성공/실패를 **호출자에게 그대로 알린다** — 백그라운드로 던져 놓고
    // "시작했다" 고만 하면, 펜이 꺼져 있어도 화면은 기다리기만 한다.
    match rx.recv_timeout(Duration::from_secs(25)) {
        Ok(Ok(())) => {
            if let Ok(mut v) = slot().lock() {
                v.push(Live { pen_id: key, stop: stop_flag });
            }
            Ok(())
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            stop_flag.store(true, Ordering::Relaxed);
            Err("펜 연결이 시간 안에 끝나지 않았습니다 — 펜 전원을 확인하고 다시 시도하세요.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    //! 실장비가 필요한 경로는 테스트가 붙지 않는다. 여기서는 **레지스트리 규칙**만
    //! 검증한다 — 중복 시작 방지·중단 후 목록 정리는 실기기 없이도 깨질 수 있다.
    use super::*;

    #[test]
    fn 없는_펜을_멈춰도_안전하다() {
        stop("존재하지-않는-펜");
        assert!(active().iter().all(|id| id != "존재하지-않는-펜"));
    }

    #[test]
    fn 전부_멈추면_목록이_빈다() {
        stop_all();
        assert!(active().is_empty());
    }
}
