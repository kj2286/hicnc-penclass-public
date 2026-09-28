//! BLE 펜 이름 변경 — `PenSetting::BtLocalName`(0x0C).
//!
//! 펜 이름은 **BLE 로만** 바꿀 수 있다 (USB 에는 대응 설정이 없음 — SDK CLAUDE.md).
//! 크래들 토폴로지는 MAC 하위 3바이트(suffix)만 주므로, 스캔 결과에서
//! 주소·제조사 데이터·광고 이름으로 suffix 를 대조해 대상을 찾는다.
//!
//! 안전 규칙 (SDK CLAUDE.md): 비밀번호는 공장값 "0000" → "" **각 1회만** 시도한다.
//! 10회 초과 시 펜이 공장 초기화된다 — 어떤 경우에도 루프를 돌리지 않는다.
//! `PenReset` 응답이 오면 즉시 중단하고 사실대로 알린다.

use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use postdemy_pen_core::ble::codec::PacketAssembler;
use postdemy_pen_core::ble::{command, parser};
use postdemy_pen_core::consts::ble_uuid;
use postdemy_pen_core::ble::command::PenSetting;
use std::time::Duration;
use uuid::Uuid;

const SCAN_SECS: u64 = 6;
const STEP_TIMEOUT: Duration = Duration::from_secs(4);

/// mac_suffix(예: "AABBCC") 의 펜을 BLE 로 찾아 BT 이름을 바꾼다.
pub async fn rename(mac_suffix: String, new_name: String) -> Result<String, String> {
    // macOS CoreBluetooth 는 어댑터 생성 직후 첫 스캔이 poweredOn 전에 시작돼
    // 빈손으로 끝나는 일이 잦다 — 첫 클릭 실패·두 번째 성공(사용자 신고)의
    // 원인. 일시 오류(못 찾음·연결 실패)는 잠깐 쉬고 1회 자동 재시도한다.
    match rename_attempt(&mac_suffix, &new_name).await {
        Err(e) if is_transient(&e) => {
            tokio::time::sleep(Duration::from_millis(1_200)).await;
            rename_attempt(&mac_suffix, &new_name).await
        }
        r => r,
    }
}

fn is_transient(e: &str) -> bool {
    e.contains("찾지 못했습니다") || e.contains("연결 실패") || e.contains("스캔 시작 실패")
}

async fn rename_attempt(mac_suffix: &str, new_name: &str) -> Result<String, String> {
    let suffix = crate::mac_key(mac_suffix);
    if suffix.is_empty() {
        return Err("펜 MAC 을 알 수 없습니다 — 슬롯 조회가 끝난 뒤 시도하세요.".into());
    }
    let suffix_bytes = hex_bytes(&suffix);

    let manager = Manager::new().await.map_err(|e| format!("BLE 초기화 실패: {e}"))?;
    let central = manager
        .adapters()
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or("블루투스 어댑터가 없습니다")?;

    central
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| format!("스캔 시작 실패 — 블루투스 권한을 확인하세요: {e}"))?;
    // 고정 대기 대신 0.5초 간격 폴링 — 대상 suffix 가 보이면 즉시 진행한다.
    let deadline = std::time::Instant::now() + Duration::from_secs(SCAN_SECS);
    let peripherals = loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let peripherals = central.peripherals().await.map_err(|e| e.to_string())?;
        let mut found = false;
        for p in &peripherals {
            let addr = p.address().to_string().to_lowercase().replace(':', "");
            if addr.ends_with(&suffix) {
                found = true;
                break;
            }
        }
        if found || std::time::Instant::now() >= deadline {
            break peripherals;
        }
    };
    let _ = central.stop_scan().await;

    // 후보 수집: Neo 계열(서비스/이름/제조사) + suffix 대조
    let mut neoish: Vec<(Peripheral, String)> = Vec::new();
    let mut matched: Vec<(Peripheral, String)> = Vec::new();
    for p in peripherals {
        let Ok(Some(props)) = p.properties().await else { continue };
        let name = props.local_name.clone().unwrap_or_default();
        let addr = p.address().to_string().to_lowercase().replace(':', "");
        let is_neo = props
            .services
            .iter()
            .any(|u| u.as_u128() == ble_uuid::SERVICE_V2 || u.as_u128() == ble_uuid::SERVICE_V5)
            || name.starts_with(ble_uuid::NAME_PREFIX)
            || props
                .manufacturer_data
                .keys()
                .any(|id| ble_uuid::MANUFACTURER_IDS.contains(id));
        if !is_neo {
            continue;
        }
        let label = if name.is_empty() { addr.clone() } else { name.clone() };
        let hit = addr.ends_with(&suffix)
            || name.to_lowercase().contains(&suffix)
            || props
                .manufacturer_data
                .values()
                .any(|v| contains_bytes(v, &suffix_bytes));
        if hit {
            matched.push((p, label));
        } else {
            neoish.push((p, label));
        }
    }

    let (pen, label) = if !matched.is_empty() {
        matched.swap_remove(0)
    } else if neoish.len() == 1 {
        // suffix 를 광고에서 못 읽는 플랫폼(macOS 는 주소를 숨긴다) —
        // Neo 펜이 딱 1자루면 그것으로 진행한다.
        neoish.swap_remove(0)
    } else if neoish.is_empty() {
        return Err(format!(
            "BLE 스캔에서 펜({mac_suffix})을 찾지 못했습니다 — 펜 전원이 켜져 있는지, \
             다른 기기(폰 등)에 연결돼 있지 않은지 확인하세요."
        ));
    } else {
        return Err(format!(
            "Neo 펜이 {}자루 검색됐지만 어느 것이 {mac_suffix} 인지 광고만으로 \
             구분할 수 없습니다 — 대상 펜만 켜고 다시 시도하세요.",
            neoish.len()
        ));
    };

    let result = rename_on(&pen, &label, new_name).await;
    let _ = pen.disconnect().await;
    result
}

async fn rename_on(pen: &Peripheral, label: &str, new_name: &str) -> Result<String, String> {
    pen.connect().await.map_err(|e| format!("{label} 연결 실패: {e}"))?;
    pen.discover_services().await.map_err(|e| e.to_string())?;

    let chars = pen.characteristics();
    // 펜 세대별 캐릭터리스틱: 구형(V2, 16-bit 2BA0/2BA1) → 신형(V5, 128-bit).
    // 포스트데미 펜(F45)은 V5 UUID 를 쓴다 — 실기기에서 2BA0 부재로 확인.
    // 프로토콜 프레이밍(C0…C1)은 두 세대가 동일하다.
    let write_char = pick_char(&chars, ble_uuid::CMD_CHAR_V2, CharPropFlags::WRITE_WITHOUT_RESPONSE)
        .or_else(|| pick_char(&chars, ble_uuid::CMD_CHAR_V2, CharPropFlags::WRITE))
        .or_else(|| pick_char(&chars, ble_uuid::CMD_CHAR_V5, CharPropFlags::WRITE_WITHOUT_RESPONSE))
        .or_else(|| pick_char(&chars, ble_uuid::CMD_CHAR_V5, CharPropFlags::WRITE))
        .ok_or_else(|| format!(
            "쓰기 캐릭터리스틱(V2 2BA0 / V5)을 찾지 못했습니다.\n발견된 캐릭터리스틱: {}",
            describe_chars(&chars)
        ))?;
    let notify_char = pick_char(&chars, ble_uuid::DATA_CHAR_V2, CharPropFlags::NOTIFY)
        .or_else(|| pick_char(&chars, ble_uuid::DATA_CHAR_V5, CharPropFlags::NOTIFY))
        .or_else(|| {
            chars
                .iter()
                .find(|c| c.properties.contains(CharPropFlags::NOTIFY))
                .cloned()
        })
        .ok_or_else(|| format!(
            "알림 캐릭터리스틱을 찾지 못했습니다.\n발견된 캐릭터리스틱: {}",
            describe_chars(&chars)
        ))?;

    pen.subscribe(&notify_char)
        .await
        .map_err(|e| format!("알림 구독 실패: {e}"))?;
    let mut stream = pen.notifications().await.map_err(|e| e.to_string())?;
    let mut asm = PacketAssembler::new();
    let write_type = if write_char.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE) {
        WriteType::WithoutResponse
    } else {
        WriteType::WithResponse
    };

    // 1) 버전 교환 0x01 → 0x81
    pen.write(&write_char, &command::version_info(), write_type)
        .await
        .map_err(|e| format!("전송 실패: {e}"))?;
    wait_for(&mut stream, &mut asm, |p| matches!(p, parser::Parsed::VersionInfo(_)))
        .await
        .map_err(|e| format!("버전 응답 없음 — {e}"))?;

    // 2) 비밀번호 — 공장값 "0000" 1회, 안 되면 "" 1회. 그 이상은 절대 시도하지 않는다.
    let mut authed = false;
    for pw in ["0000", ""] {
        let frame = command::password_compare(pw).map_err(|e| format!("{e:?}"))?;
        pen.write(&write_char, &frame, write_type)
            .await
            .map_err(|e| format!("전송 실패: {e}"))?;
        match wait_for(&mut stream, &mut asm, |p| {
            matches!(p, parser::Parsed::Password { .. } | parser::Parsed::PenStatus(_))
        })
        .await
        {
            Ok(parser::Parsed::Password { status, retries_used, max_retries }) => match status {
                parser::PasswordStatus::Accepted => {
                    authed = true;
                    break;
                }
                parser::PasswordStatus::PenReset => {
                    return Err(
                        "펜이 방금 공장 초기화되었습니다 — 저장된 필기가 이미 삭제된 상태입니다. \
                         이름 변경을 중단합니다."
                            .into(),
                    );
                }
                parser::PasswordStatus::Required => {
                    if pw.is_empty() {
                        return Err(format!(
                            "비밀번호가 설정된 펜입니다 (시도 {retries_used}/{max_retries}) — \
                             안전을 위해 더 시도하지 않습니다. 펜 비밀번호를 해제한 뒤 다시 하세요."
                        ));
                    }
                }
                other => return Err(format!("예상 밖 비밀번호 응답: {other:?}")),
            },
            Ok(parser::Parsed::PenStatus(_)) => {
                authed = true; // 인증 완료 시 펜이 상태를 자동 송신한다
                break;
            }
            Ok(_) => {}
            Err(e) => return Err(format!("비밀번호 응답 없음 — {e}")),
        }
    }
    if !authed {
        return Err("펜 인증에 실패했습니다".into());
    }

    // 3) 이름 변경 0x05 / 서브타입 0x0C (BtLocalName)
    let frame = command::change_setting(&PenSetting::BtLocalName(new_name.to_string()))
        .map_err(|e| format!("이름이 규격에 맞지 않습니다(최대 16바이트): {e:?}"))?;
    pen.write(&write_char, &frame, write_type)
        .await
        .map_err(|e| format!("전송 실패: {e}"))?;
    match wait_for(&mut stream, &mut asm, |p| {
        matches!(p, parser::Parsed::SettingChanged { .. })
    })
    .await
    {
        Ok(parser::Parsed::SettingChanged { ok: true, .. }) => Ok(format!(
            "✔ \"{new_name}\" 저장 완료 — 펜을 껐다 켜면 새 이름으로 검색됩니다."
        )),
        // 길이 바이트(0x10) 포함 형식(SDK 54dc4b8)은 F45 실기기에서 수락된다 —
        // 그래도 거부되면 일시 상태일 가능성이 커 재시도를 안내한다.
        Ok(parser::Parsed::SettingChanged { ok: false, setting_type }) => Err(format!(
            "펜이 이름 변경을 거부했습니다 (subtype 0x{setting_type:02X}). \
             펜을 크래들에서 뽑아 전원을 껐다 켠 뒤 다시 시도해주세요."
        )),
        Ok(_) => Err("예상 밖 응답".into()),
        Err(e) => Err(format!("이름 변경 응답 없음 — {e}")),
    }
}

/// 진단용 — 연결한 기기의 캐릭터리스틱 UUID·속성 나열 (실패 메시지에 포함).
fn describe_chars(chars: &std::collections::BTreeSet<Characteristic>) -> String {
    if chars.is_empty() {
        return "(없음)".into();
    }
    chars
        .iter()
        .map(|c| format!("{} [{:?}]", c.uuid, c.properties))
        .collect::<Vec<_>>()
        .join(", ")
}

fn pick_char(
    chars: &std::collections::BTreeSet<Characteristic>,
    uuid128: u128,
    want: CharPropFlags,
) -> Option<Characteristic> {
    let target = Uuid::from_u128(uuid128);
    chars
        .iter()
        .find(|c| c.uuid == target && c.properties.contains(want))
        .cloned()
}

/// 알림 스트림에서 조건에 맞는 응답을 기다린다. 이벤트(도트 등)는 건너뛴다.
async fn wait_for(
    stream: &mut (impl futures::Stream<Item = btleplug::api::ValueNotification> + Unpin),
    asm: &mut PacketAssembler,
    pred: impl Fn(&parser::Parsed) -> bool,
) -> Result<parser::Parsed, String> {
    let deadline = tokio::time::Instant::now() + STEP_TIMEOUT;
    loop {
        // 이미 버퍼에 조립된 패킷 먼저 소화
        while let Some(pkt) = asm.next_packet() {
            let Ok(pkt) = pkt else { continue };
            let Ok(parsed) = parser::parse(&pkt) else { continue };
            if pred(&parsed) {
                return Ok(parsed);
            }
        }
        let remain = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remain.is_zero() {
            return Err(format!("{STEP_TIMEOUT:?} 안에 응답이 오지 않았습니다"));
        }
        match tokio::time::timeout(remain, stream.next()).await {
            Ok(Some(noti)) => asm.push(&noti.value),
            Ok(None) => return Err("BLE 연결이 끊겼습니다".into()),
            Err(_) => return Err(format!("{STEP_TIMEOUT:?} 안에 응답이 오지 않았습니다")),
        }
    }
}

fn hex_bytes(hex: &str) -> Vec<u8> {
    hex.as_bytes()
        .chunks(2)
        .filter_map(|c| std::str::from_utf8(c).ok())
        .filter_map(|s| u8::from_str_radix(s, 16).ok())
        .collect()
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    !needle.is_empty() && haystack.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::indexing_slicing, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn hex_bytes_변환() {
        assert_eq!(hex_bytes("1a78e8"), vec![0x1a, 0x78, 0xe8]);
    }

    #[test]
    fn contains_bytes_부분_일치() {
        assert!(contains_bytes(&[0x9c, 0x7b, 0xd2, 0x1a, 0x78, 0xe8], &[0x1a, 0x78, 0xe8]));
        assert!(!contains_bytes(&[0x00, 0x01], &[0x1a]));
        assert!(!contains_bytes(&[0x00], &[]));
    }
}
