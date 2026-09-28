//! 크래들 접근 계층 — 전부 **블로킹**이라 반드시 `spawn_blocking` 에서 부른다
//! (SDK CLAUDE.md: `PenSession` 은 요청당 최대 8초 이상 막힐 수 있다).
//!
//! 흐름은 SDK `penprobe` 를 그대로 따른다:
//! 토폴로지 발견(포트 안 엶) → 슬롯 조회(READ ONLY 세션) →
//! 오프라인 파일 T/C 다운로드(`clamp_chunk`) → `parse_offline_note`(무필압 옵션).

use serde::Serialize;

use postdemy_pen_core::usb::cradle::CradleModel;
// offline 파서는 업스트림 e93959a 에서 전송 중립 모듈로 이동 (usb::offline → offline)
use postdemy_pen_core::offline;
use postdemy_pen_core::usb::constants;
use postdemy_pen_core::types::Stroke as CoreStroke;
use postdemy_pen_desktop::session::{PenSession, SessionError};
use postdemy_pen_desktop::topology;
use postdemy_pen_desktop::Safety;
use std::time::Duration;

const SESSION_TIMEOUT: Duration = Duration::from_millis(2500);

/// UI 에 그리는 슬롯 한 칸. 크래들 1대 = 물리 슬롯 1..=10.
/// (camelCase 직렬화 — Tauri invoke 로 웹 화면이 그대로 받는다)
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotView {
    pub physical_slot: u8,
    /// 펜이 꽂혀 있으면 시리얼 포트 경로.
    pub port: Option<String>,
    /// iInterface 에서 읽은 모델명 (포트 안 열고 얻음). 예: "NWP-F45-PD".
    pub model: Option<String>,
    /// MAC 하위 3바이트 hex. 매핑 키로 쓴다. 예: "AABBCC".
    pub mac_suffix: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CradleView {
    pub model: String,
    pub slots: Vec<SlotView>, // 항상 10칸
    pub pen_count: usize,
}

/// READ ONLY 세션으로 읽은 슬롯 상세 — 웹으로 보내는 평탄 DTO.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeInfo {
    pub model_name: String,
    /// 펜에 저장된 이름(BLE local name 과 같은 필드로 추정 — 실장비 검증 대상).
    /// 이름을 바꾸면 여기가 바뀌므로 화면은 모델명 대신 이걸 먼저 보여준다.
    pub sub_name: String,
    pub fw_version: String,
    /// 전체 MAC hex 12자리 (콜론 없음, 소문자).
    pub mac_full: String,
    pub disk_total_kb: u64,
    pub disk_free_kb: u64,
    pub offline_files: usize,
    /// 파일 목록이 잘렸는가 (선언 개수보다 적게 옴 — 알리지 않으면 유실을 모른다).
    pub list_truncated: bool,
}

/// 일괄 수신 한 슬롯의 결과.
#[derive(Debug, Clone)]
pub struct PullOutcome {
    pub strokes: Vec<CoreStroke>,
    /// 원본 파일 (이름, 바이트) — 로컬 덤프용. 실펜 필기는 다시 만들 수 없다.
    pub raw_files: Vec<(String, Vec<u8>)>,
    pub skipped_records: usize,
    pub note_pairs: usize,
}

fn model_name(m: &CradleModel) -> String {
    format!("{m:?}")
}

/// `"COM7|4.3"` (COM 이름 | **크래들 1단 허브 기준 상대 포트경로**) → (포트, 슬롯).
///
/// 🚨 크래들은 납작한 허브가 아니라 **2단 허브 트리**다. 인쇄된 슬롯 번호는
/// 마지막 홉의 포트 번호가 아니라 **경로**로 정해진다(KAIT F45: 4.3→1, 4.2→4,
/// 1→5, 3.1→7 …). 처음에 마지막 홉만 읽었다가 1·4번에 꽂은 펜이 3·2번으로
/// 보이는 실사고(2026-08-17 윈도우 0.2.17). 변환 표는 맥(ioreg 토폴로지)에서
/// 실기기 검증된 코어의 `CradleModel` 을 그대로 쓴다 — 두 OS 가 같은 표를 봐야
/// 같은 슬롯이 나온다.
pub fn parse_slot_lines(out: &str) -> Vec<(String, u8)> {
    out.lines()
        .filter_map(|line| {
            let mut parts = line.trim().split('|');
            let com = parts.next()?.trim();
            if com.is_empty() {
                return None;
            }
            // 🚨 경로 후보를 **여러 개** 받는다 (2026-09-01 실사고: 3번에 꽂은
            // 펜이 1번으로). 1차 경로는 LocationInfo 를 홉마다 정규식으로 읽어
            // 조립하는데, 펜 노드의 LocationInfo 가 다른 형식인 기기에서는
            // 마지막 홉이 빠져 "4.1" 이 "4" 가 된다 — 표에 없어 조용히 버려지고
            // 폴백이 빈 첫 칸(1번)에 놓았다. 2차 경로(LocationPaths 파생)까지
            // 차례로 표에 대 본다. 표에 없는 번호를 지어내는 것보다 안전하다.
            parts
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .find_map(|path| {
                    let slot = CradleModel::KaitF45
                        .slot_for(path)
                        .or_else(|| CradleModel::Z100R00.slot_for(path))?;
                    // Z100 슬롯 0 은 NFC 리더 — 펜 슬롯이 아니다
                    if CradleModel::Z100R00.is_non_pen_slot(slot)
                        && CradleModel::KaitF45.slot_for(path).is_none()
                    {
                        return None;
                    }
                    Some((com.to_string(), slot))
                })
        })
        .collect()
}

/// 윈도우에서만 실제 조회한다 — 그 외 OS 는 토폴로지 경로를 타므로 빈 목록.
///
/// `ports_key` 는 지금 꽂힌 펜 포트 목록(정렬). **같은 키면 캐시를 돌려준다** —
/// 크래들 화면이 몇 초마다 폴링하는데 매번 PowerShell 을 띄우면 느리고,
/// 콘솔 창이 계속 깜빡인다(실사고 2026-08-17: "크래들 연결하면 팝업이 계속 뜸").
/// 펜을 꽂거나 빼면 포트 목록이 바뀌어 키가 달라지므로 그때만 다시 조회한다.
#[cfg(windows)]
fn port_slot_map(ports_key: &[String]) -> Vec<(String, u8)> {
    use std::os::windows::process::CommandExt;
    use std::sync::Mutex;
    // 🚨 **스냅샷을 절대 막지 않는다.** 0.2.18 은 이 조회를 동기로 돌렸는데
    // PowerShell 이 전 장치를 훑는 구조라 수십 초가 걸렸고, 그동안 크래들
    // 조회 전체가 멈춰 "크래들이 안 잡힌다" 로 보였다(2026-08-17 실사고).
    // 지금은: 캐시에 있으면 즉시 반환, 없으면 **백그라운드로 조회**를 걸고
    // 일단 빈 목록(순서 배치 폴백)을 돌려준다 — 몇 초 뒤 폴링부터 정확한
    // 슬롯 번호가 나온다. 펜은 항상 즉시 보인다.
    static CACHE: Mutex<Option<(Vec<String>, Vec<(String, u8)>)>> = Mutex::new(None);
    static PENDING: Mutex<Option<Vec<String>>> = Mutex::new(None);

    if let Ok(g) = CACHE.lock() {
        if let Some((k, v)) = g.as_ref() {
            if k == ports_key {
                return v.clone();
            }
        }
    }
    // 같은 키 조회가 이미 돌고 있으면 또 띄우지 않는다
    if let Ok(mut pend) = PENDING.lock() {
        if pend.as_deref() == Some(ports_key) {
            return Vec::new();
        }
        *pend = Some(ports_key.to_vec());
    }

    let key = ports_key.to_vec();
    std::thread::spawn(move || {
        // 콘솔 창을 만들지 않는다 — 이 플래그가 없으면 실행마다 검은 창이 뜬다.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        // Ports 클래스(= COM 포트, 몇 개뿐)만 순회 — 전 장치 순회(0.2.18)는
        // 장치 수백 개 × 속성 조회로 수십 초가 걸렸다.
        const PS: &str = r#"$ErrorActionPreference='SilentlyContinue'
function PV([string]$id,[string]$k){(Get-PnpDeviceProperty -InstanceId $id -KeyName $k -ErrorAction SilentlyContinue).Data}
foreach($port in (Get-PnpDevice -Class Ports -PresentOnly)){
  if($port.FriendlyName -notmatch '\((COM\d+)\)'){continue}
  $com=$Matches[1]
  $cur=$port.InstanceId
  $pen=''
  for($i=0;$i -lt 8 -and $cur;$i++){
    if($cur -like '*VID_0E8D&PID_0023*'){$pen=$cur;break}
    $cur=PV $cur 'DEVPKEY_Device_Parent'
  }
  if(-not $pen){continue}
  $path=@()
  $loc=PV $pen 'DEVPKEY_Device_LocationInfo'
  if($loc -match 'Port_#0*(\d+)'){$path=@([int]$Matches[1])}
  $depth=0
  $cur=PV $pen 'DEVPKEY_Device_Parent'
  while($cur -and $cur -like '*VID_1A86*PID_8091*'){
    $depth++
    $parent=PV $cur 'DEVPKEY_Device_Parent'
    $pl=PV $cur 'DEVPKEY_Device_LocationInfo'
    if($parent -and $parent -like '*VID_1A86*PID_8091*' -and $pl -match 'Port_#0*(\d+)'){$path=@([int]$Matches[1])+$path}
    $cur=$parent
  }
  $alt=''
  $lp=PV $pen 'DEVPKEY_Device_LocationPaths'
  if($lp){
    $usb=[regex]::Matches(@($lp)[0],'#USB\((\d+)\)') | ForEach-Object { [int]$_.Groups[1].Value }
    if($depth -gt 0 -and @($usb).Count -ge $depth){ $alt=(@($usb) | Select-Object -Last $depth) -join '.' }
  }
  "$com|$($path -join '.')|$alt"
}"#;
        let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", PS])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let (raw, v) = match out {
            Ok(o) => {
                let raw = String::from_utf8_lossy(&o.stdout).to_string();
                let v = parse_slot_lines(&raw);
                (raw, v)
            }
            Err(e) => (format!("(powershell 실행 실패: {e})"), Vec::new()),
        };
        // 진단 흔적 — 슬롯이 엉뚱하게 나올 때 이 파일을 보면 원인이 보인다
        // (2026-09-01 실사고: 3번에 꽂았는데 1번 표시 — 원인 데이터가 없어
        //  원격 진단이 불가능했다). %TEMP%\penclass-slot-debug.txt
        let dbg = std::env::temp_dir().join("penclass-slot-debug.txt");
        let _ = std::fs::write(
            &dbg,
            format!(
                "== 크래들 슬롯 매핑 진단 ==\n포트: {:?}\n\n[PowerShell 원문]\n{}\n[매핑 결과]\n{:?}\n",
                key, raw, v
            ),
        );
        if let Ok(mut g) = CACHE.lock() {
            *g = Some((key, v));
        }
        if let Ok(mut pend) = PENDING.lock() {
            *pend = None;
        }
    });
    Vec::new()
}

#[cfg(not(windows))]
fn port_slot_map(_ports_key: &[String]) -> Vec<(String, u8)> {
    Vec::new()
}

/// USB 토폴로지 없이 펜을 찾는 폴백 — **윈도우·리눅스용**.
///
/// SDK 의 `discover_cradles` 는 macOS `ioreg` 전용이라 다른 OS 에서는 항상
/// Unsupported 를 낸다(2026-08-14 윈도우 실사고: 크래들이 아예 안 잡힘).
/// 여기서는 시리얼 포트 목록에서 **펜 VID/PID** 만 골라 슬롯을 만든다.
/// 크래들은 1대로 묶고, **슬롯 번호는 USB 허브의 실제 포트 번호**를 쓴다.
/// (2026-08-17 실사고: 4번 슬롯에 꽂은 펜이 늘 1번으로 보였다 — 꽂힌 순서대로
/// 1번부터 채웠기 때문. 위치를 못 읽을 때만 순서대로 채운다.)
fn snapshot_via_serial() -> Result<Vec<CradleView>, String> {
    use postdemy_pen_core::usb::constants::usb_id;
    let ports = serialport::available_ports()
        .map_err(|e| format!("시리얼 포트 목록 조회 실패: {e}"))?;
    let mut pens: Vec<(String, String)> = Vec::new(); // (포트, MAC suffix 대용)
    let mut seen_devices: Vec<String> = Vec::new();
    for p in ports {
        if let serialport::SerialPortType::UsbPort(info) = &p.port_type {
            if info.vid != usb_id::PEN_VID || info.pid != usb_id::PEN_PID {
                continue;
            }
            // 🚨 **한 자루가 두 포트로 보인다.** macOS 는 같은 장치를 `tty.*` 와
            // `cu.*` 로 둘 다 내놓고, 윈도우의 복합 장치도 포트를 두 개 열거한다.
            // 그대로 담으면 펜 1자루가 슬롯 2칸을 차지한다 —— 실사고 2026-08-17:
            // "1개 꽂았는데 2개가 잡히고 이름·파일 수·퍼센트가 똑같다".
            // 장치 정체성(시리얼 번호)이 같으면 하나로 본다.
            if p.port_name.contains("tty.") {
                // macOS: 열기용은 `cu.*` 다. `tty.*` 는 캐리어 감지를 기다려 멈춘다.
                continue;
            }
            // 시리얼이 **빈 문자열**인 칩이 있다(CH340 계열) — 그대로 쓰면 두
            // 자루가 같은 "" 로 중복 판정돼 한 자루가 사라진다. 포트명으로 폴백.
            let ident = info
                .serial_number
                .clone()
                .filter(|sn| !sn.is_empty())
                .unwrap_or_else(|| p.port_name.clone());
            if seen_devices.contains(&ident) {
                continue;
            }
            seen_devices.push(ident);
            // 시리얼 번호가 있으면 매핑 키로 쓴다(없으면 포트명 끝 6자).
            let key = info
                .serial_number
                .clone()
                .unwrap_or_else(|| p.port_name.clone());
            let suffix = key.chars().rev().take(6).collect::<String>();
            let suffix: String = suffix.chars().rev().collect();
            pens.push((p.port_name.clone(), suffix.to_uppercase()));
        }
    }
    if pens.is_empty() {
        return Ok(Vec::new());
    }
    pens.sort_by(|a, b| a.0.cmp(&b.0));
    let mut slots: Vec<SlotView> = (1..=10)
        .map(|n| SlotView { physical_slot: n, ..Default::default() })
        .collect();
    let mut ports_key: Vec<String> = pens.iter().map(|(p, _)| p.clone()).collect();
    ports_key.sort();
    let located = port_slot_map(&ports_key);
    let mut placed = 0usize;
    for (port, suffix) in pens.iter() {
        // 허브 포트 번호를 알면 그 자리에, 모르면 비어 있는 첫 칸에 놓는다.
        let idx = located
            .iter()
            .find(|(p, _)| p == port)
            .map(|(_, n)| *n as usize)
            .filter(|n| (1..=10).contains(n))
            .map(|n| n - 1)
            .filter(|i| slots[*i].port.is_none())
            .or_else(|| slots.iter().position(|s| s.port.is_none()));
        let Some(i) = idx else { break };
        slots[i].port = Some(port.clone());
        slots[i].model = Some("NWP-F45".to_string());
        slots[i].mac_suffix = Some(suffix.clone());
        placed += 1;
    }
    let pen_count = placed;
    Ok(vec![CradleView { model: "Cradle".to_string(), slots, pen_count }])
}

/// 크래들·슬롯 발견 — 포트를 전혀 열지 않으므로 폴링해도 안전하다.
pub fn snapshot() -> Result<Vec<CradleView>, String> {
    // macOS 외에는 토폴로지 열거가 없다 — 시리얼 포트 폴백으로 간다
    let cradles = match topology::discover_cradles() {
        Ok(v) => v,
        Err(_) => return snapshot_via_serial(),
    };
    let mut out = Vec::new();
    for c in cradles {
        if c.model == CradleModel::Unknown {
            continue;
        }
        let mut slots: Vec<SlotView> = (1..=10)
            .map(|n| SlotView { physical_slot: n, ..Default::default() })
            .collect();
        for s in &c.slots {
            let Some(n) = s.physical_slot else { continue };
            let Some(view) = slots.iter_mut().find(|v| v.physical_slot == n) else { continue };
            if s.has_pen() {
                view.port = s.serial_port.clone();
                if let Some((model, mac)) = s.model_and_mac_suffix() {
                    view.model = Some(model.to_string());
                    view.mac_suffix = Some(mac.to_string());
                } else {
                    view.model = s.identity.clone();
                }
            }
        }
        let pen_count = slots.iter().filter(|s| s.port.is_some()).count();
        out.push(CradleView { model: model_name(&c.model), slots, pen_count });
    }
    Ok(out)
}

fn open(port: &str) -> Result<PenSession, String> {
    PenSession::open_with_timeout(port, Safety::ReadOnly, SESSION_TIMEOUT)
        .map_err(|e| format!("세션 열기 실패: {e}"))
}

/// 슬롯 상세 조회 — 기기정보 + 저장소 + 오프라인 파일 수.
/// 🔒 시리얼 포트 전역 잠금 — probe/pull/erase 가 **겹치면 같은 포트를 동시에
/// 열어** 간헐 실패가 났다(2026-08-19 실사고: "한번에 받기가 가끔 데이터를 못
/// 받는다"). 받기 직전에 이미 날아가던 슬롯 조회와 수신이 충돌하는 창이 있다.
/// 전부 블로킹 계층(spawn_blocking)이므로 std Mutex 로 직렬화한다 — 겹친 호출은
/// 기다렸다가 차례로 실행된다. 스냅샷(포트 목록만 읽음)은 잠그지 않는다.
static SERIAL_OP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn serial_guard() -> std::sync::MutexGuard<'static, ()> {
    SERIAL_OP_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn probe(port: &str) -> Result<ProbeInfo, String> {
    let _serial = serial_guard();
    let mut sess = open(port)?;
    let device = sess.device_info().map_err(|e| format!("GETDEVINFO 실패: {e}"))?;
    let mac_full = device
        .mac_address
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let disk = sess.disk_info().map_err(|e| format!("GETDISKINFO 실패: {e}"))?;
    let list = sess
        .offline_file_list()
        .map_err(|e| format!("GETOFFLINEDATALIST 실패: {e}"))?;
    Ok(ProbeInfo {
        model_name: device.model_name,
        sub_name: device.sub_name,
        fw_version: device.firmware_version,
        mac_full,
        disk_total_kb: disk.total_bytes / 1024,
        disk_free_kb: disk.free_bytes() / 1024,
        offline_files: list.entries.len(),
        list_truncated: list.truncated(),
    })
}

/// `GETFILE_H` 로 열고 `GETFILE_D` 로 끝까지 — 청크는 펜이 알려준 크기로 깎는다
/// (penprobe `download` 이식. 512 고정으로 밀면 펜 버퍼를 넘긴다).
fn download(sess: &mut PenSession, path: &str) -> Result<Vec<u8>, SessionError> {
    let head = sess.file_header(path)?;
    if head.status != constants::file_open_status::SUCCESS {
        return Err(SessionError::Core(postdemy_pen_core::CoreError::PenRejected {
            code: 0,
            status: head.status,
        }));
    }
    let want = head.clamp_chunk(constants::chunk::DEFAULT_FILE);
    let mut out: Vec<u8> = Vec::with_capacity(head.size_bytes as usize);
    while (out.len() as u32) < head.size_bytes {
        let remain = head.size_bytes - out.len() as u32;
        let n = want.min(remain);
        let chunk = sess.file_chunk(out.len() as u32, n)?;
        if chunk.status != constants::file_read_status::SUCCESS {
            return Err(SessionError::Core(postdemy_pen_core::CoreError::PenRejected {
                code: 0,
                status: chunk.status,
            }));
        }
        if chunk.data.is_empty() {
            break; // 진행이 멈췄다 — 무한 루프 방지 (penprobe 와 동일)
        }
        out.extend_from_slice(&chunk.data);
    }
    Ok(out)
}

/// 슬롯 하나의 오프라인 필기를 전부 내려받아 파싱한다 (읽기 전용 — 펜 데이터는 남는다).
pub fn pull(port: &str) -> Result<PullOutcome, String> {
    let _serial = serial_guard();
    let mut sess = open(port)?;
    let list = sess
        .offline_file_list()
        .map_err(|e| format!("GETOFFLINEDATALIST 실패: {e}"))?;
    if list.truncated() {
        // 잘린 목록은 배치의 일부 유실을 뜻한다 — 오류로 세워 알린다.
        return Err(format!(
            "파일 목록이 잘렸습니다 — 선언 {} / 수신 {}. 다시 시도하세요.",
            list.declared_count,
            list.entries.len()
        ));
    }

    let mut raw_files: Vec<(String, Vec<u8>)> = Vec::new();
    for f in &list.entries {
        let path = format!("{}{}", constants::path::OFFLINE_DIR, f.name);
        let bytes = download(&mut sess, &path).map_err(|e| format!("{path} 다운로드 실패: {e}"))?;
        raw_files.push((f.name.clone(), bytes));
    }

    // T/C 접두사 짝으로 파싱. O 파일에는 필기가 없다 (penprobe 와 동일).
    // F45 는 필압 센서가 없다 — 분모를 852 로 두면 정규화가 전부 뭉갠다.
    let opts = offline::OfflineOptions {
        max_pressure: offline::PRESSURELESS_PRESSURE,
        ..offline::OfflineOptions::default()
    };
    let mut strokes: Vec<CoreStroke> = Vec::new();
    let mut skipped = 0usize;
    let mut pairs = 0usize;
    for (name, t) in raw_files.iter().filter(|(n, _)| n.ends_with('t')) {
        let prefix = name.trim_end_matches('t');
        let Some((_, c)) = raw_files.iter().find(|(n, _)| n == &format!("{prefix}c")) else {
            // 짝(C) 없는 T 파일 = 그 노트 배치의 필기를 **통째로** 못 읽는다.
            // 예전엔 조용히 건너뛰어 사용자에게 "일부 페이지가 없다"로만 보였다
            // (2026-08-19 실사고 의심 경로: 이서진 p.315~317 통째 누락).
            // skipped 로 세어 웹의 수신 경고에 잡히게 한다.
            skipped = skipped.saturating_add(1);
            continue;
        };
        let note = offline::parse_offline_note(t, c, &opts)
            .map_err(|e| format!("{prefix} 파싱 실패: {e:?}"))?;
        pairs += 1;
        skipped += note.skipped_records;
        strokes.extend(note.strokes);
    }
    Ok(PullOutcome { strokes, raw_files, skipped_records: skipped, note_pairs: pairs })
}


/// 펜 데이터 삭제 결과 — 웹 화면 안내용.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EraseOutcome {
    pub deleted_files: usize,
    /// 삭제 후에도 남은 파일 수 — 0 이 아니면 화면이 재시도를 안내한다.
    pub remaining_files: usize,
}

/// 슬롯 하나의 오프라인 필기 파일을 **전부 삭제**한다 — 되돌릴 수 없다.
///
/// FORMAT(저장소 통째 포맷)이 아니라 오프라인 파일별 DELETEFILE 을 쓴다 —
/// 펜 이름·설정은 남기고 필기 기록만 지운다. 세션은 파괴 허용으로 열지만
/// 이 함수가 부르는 파괴 명령은 DELETEFILE 하나뿐이다.
pub fn erase(port: &str) -> Result<EraseOutcome, String> {
    let _serial = serial_guard();
    let mut sess = PenSession::open_with_timeout(port, Safety::AllowDestructive, SESSION_TIMEOUT)
        .map_err(|e| format!("세션 열기 실패: {e}"))?;
    let mut deleted = 0usize;
    // 목록이 한 응답에 다 안 올 수 있다(truncated) — 빌 때까지 라운드를 돈다.
    for _ in 0..32 {
        let list = sess
            .offline_file_list()
            .map_err(|e| format!("GETOFFLINEDATALIST 실패: {e}"))?;
        if list.entries.is_empty() {
            return Ok(EraseOutcome { deleted_files: deleted, remaining_files: 0 });
        }
        for f in &list.entries {
            let path = format!("{}{}", constants::path::OFFLINE_DIR, f.name);
            sess.delete_file(&path).map_err(|e| format!("{path} 삭제 실패: {e}"))?;
            deleted += 1;
        }
    }
    let remaining = sess.offline_file_list().map(|l| l.entries.len()).unwrap_or(0);
    Ok(EraseOutcome { deleted_files: deleted, remaining_files: remaining })
}

/// 수신 폴더: `~/Documents/하이씨앤씨 펜클래스 수신/YYYY-MM-DD/{label}/`.
pub fn receive_dir(date_key: &str, label: &str) -> std::path::PathBuf {
    let docs = directories::UserDirs::new()
        .and_then(|u| u.document_dir().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let dir = docs.join("하이씨앤씨 펜클래스 수신").join(date_key).join(label);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Tauri 커맨드용 수신 결과 — 웹 호환 스트로크 + 로컬 덤프 위치.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullWeb {
    pub strokes: Vec<crate::webfmt::WebStroke>,
    pub note_pairs: usize,
    pub skipped_records: usize,
    /// 원본(T/C/O) 덤프 폴더 — 실펜 필기는 다시 만들 수 없어 항상 남긴다.
    pub raw_dir: String,
}

/// 슬롯 수신 → 원본 로컬 덤프 → 웹 호환 스트로크 반환.
/// 업로드·(학생,날짜) 병합은 **웹 화면이 자기 로직으로** 한다 (중복 구현 금지).
pub fn pull_web(port: &str, slot: u8, label: &str) -> Result<PullWeb, String> {
    let outcome = pull(port)?;
    let now = chrono::Local::now();
    let dir = receive_dir(&now.format("%Y-%m-%d").to_string(), label);
    for (name, bytes) in &outcome.raw_files {
        let _ = std::fs::write(dir.join(format!("raw-slot{slot}-{name}")), bytes);
    }
    let strokes =
        crate::webfmt::to_web_strokes(&outcome.strokes, chrono::Utc::now().timestamp_millis());
    Ok(PullWeb {
        strokes,
        note_pairs: outcome.note_pairs,
        skipped_records: outcome.skipped_records,
        raw_dir: dir.display().to_string(),
    })
}

#[cfg(test)]
mod slot_location_tests {
    use super::parse_slot_lines;

    #[test]
    fn 경로를_실기기_검증된_표로_슬롯에_매핑한다() {
        // KAIT F45: 4.3→1, 4.2→4, 1→5, 3.1→7 (맥 ioreg 실기기와 같은 표)
        let out = "COM7|4.3\nCOM9|4.2\nCOM3|1\nCOM5|3.1\n";
        assert_eq!(
            parse_slot_lines(out),
            vec![
                ("COM7".to_string(), 1),
                ("COM9".to_string(), 4),
                ("COM3".to_string(), 5),
                ("COM5".to_string(), 7),
            ]
        );
    }

    #[test]
    fn 사용자_실사고_재현_1번과_4번() {
        // 1·4번에 꽂았는데 마지막 홉만 읽어 3·2번으로 보이던 사고 —
        // 경로 기반이면 정확히 1·4 가 나온다.
        let out = "COM7|4.3\nCOM9|4.2\n";
        let v = parse_slot_lines(out);
        assert_eq!(v[0].1, 1);
        assert_eq!(v[1].1, 4);
    }

    #[test]
    fn 일차_경로가_잘려도_이차_경로로_슬롯을_찾는다() {
        // 2026-09-01 실사고: 펜 노드의 LocationInfo 형식이 달라 1차 경로가
        // "4" 로 잘렸다("4.1" 이어야 함) — 표에 없어 버려지고 1번 폴백.
        // LocationPaths 파생 2차 경로가 있으면 그걸로 3번을 찾는다.
        assert_eq!(
            parse_slot_lines("COM7|4|4.1\n"),
            vec![("COM7".to_string(), 3)]
        );
        // 1차가 정상이면 1차가 이긴다
        assert_eq!(
            parse_slot_lines("COM7|4.3|4.1\n"),
            vec![("COM7".to_string(), 1)]
        );
        // 둘 다 표에 없으면 종전처럼 버린다 — 틀린 번호보다 없는 편이 낫다
        assert!(parse_slot_lines("COM7|4|9.9\n").is_empty());
    }

    #[test]
    fn 표에_없는_경로나_빈_값은_버린다() {
        assert!(parse_slot_lines("COM7|9.9\n").is_empty());
        assert!(parse_slot_lines("COM7|\n").is_empty());
        assert!(parse_slot_lines("|4.3\n").is_empty());
    }
}
