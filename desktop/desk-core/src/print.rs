//! ncode PDF **바로 출력** — 프린터의 IPP 엔드포인트에 직접 Print-Job 을 보낸다 (2026-09-03).
//!
//! 근거: BE.ngs.NcodeGenerateService `cmd/print-lab/ipp-print.sh` (NGS 팀 실측 2026-09-02).
//! - CUPS 큐를 거치면 Generic PPD 는 해상도를 지시하지 못하고, 드라이버리스(IPP Everywhere)
//!   큐는 URF ≤600dpi 라 1200dpi ncode 가 600 으로 RIP 된다. 그래서 **IPP 엔드포인트에
//!   직접** 제출하고 `printer-resolution` 을 잡 속성으로 명시한다.
//! - 제출 후 Get-Job-Attributes 로 프린터가 **기록한** 해상도를 회수해 요청값과 대조한다.
//!   `successful-ok-ignored-or-substituted-attributes` 로 조용히 600 이 되는 것을 잡기 위해서다.
//! - `print-scaling=none` 으로 실제 크기 인쇄를 강제한다 (ncode 는 배율이 바뀌면 인식이 깨진다).
//!
//! 스크립트는 macOS 의 `ipptool`/`ippfind` 에 기댔지만, 선생님 PC 는 윈도우가 많아
//! 순수 Rust(ipp 크레이트 + mDNS) 로 구현했다 — 두 OS 에서 같은 코드가 돈다.
use std::{
    collections::BTreeMap,
    io::Cursor,
    time::{Duration, Instant},
};

use ipp::{
    attribute::IppAttribute,
    model::{DelimiterTag, StatusCode},
    operation::builder::IppOperationBuilder,
    payload::IppPayload,
    prelude::{IppClient, Uri},
    value::IppValue,
};
use mdns_sd::{ServiceDaemon, ServiceEvent};
use serde::Serialize;

const USER_NAME: &str = "penclass-desk";
/// 1200dpi ncode PDF 는 수십 MB 다 — 다운로드 상한을 넉넉히 둔다.
const MAX_PDF_BYTES: u64 = 300 * 1024 * 1024;

/// mDNS 로 찾은 IPP 프린터.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Printer {
    /// 서비스 이름 (예: "FUJIFILM ApeosPort Print C3320SD")
    pub name: String,
    pub host: String,
    pub address: String,
    pub port: u16,
    /// `ipp://<ip>:<port>/<rp>` — Print-Job 을 보낼 주소
    pub uri: String,
    /// TXT `pdl` (지원 문서 형식 목록) — 있으면 그대로
    pub pdl: String,
}

/// `_ipp._tcp` 서비스를 `secs` 초 동안 훑는다. 실패는 빈 목록(수동 입력으로 진행).
pub fn discover(secs: u64) -> Vec<Printer> {
    let Ok(mdns) = ServiceDaemon::new() else {
        return Vec::new();
    };
    let Ok(rx) = mdns.browse("_ipp._tcp.local.") else {
        return Vec::new();
    };
    let deadline = Instant::now() + Duration::from_secs(secs.clamp(1, 30));
    let mut found: BTreeMap<String, Printer> = BTreeMap::new();
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match rx.recv_timeout(deadline - now) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let name = info
                    .get_fullname()
                    .split("._ipp._tcp")
                    .next()
                    .unwrap_or("")
                    .replace("\\032", " ")
                    .trim()
                    .to_string();
                // IPv4 를 우선 — 학원 공유기 환경에서 IPv6 링크로컬은 프린터가 못 받는 경우가 있다
                let mut addrs: Vec<String> = info
                    .get_addresses()
                    .iter()
                    .map(|a| a.to_ip_addr())
                    .filter(|a| a.is_ipv4())
                    .map(|a| a.to_string())
                    .collect();
                if addrs.is_empty() {
                    addrs = info
                        .get_addresses()
                        .iter()
                        .map(|a| a.to_ip_addr().to_string())
                        .collect();
                }
                let Some(address) = addrs.into_iter().next() else {
                    continue;
                };
                let rp = info
                    .txt_properties
                    .get_property_val_str("rp")
                    .unwrap_or("ipp/print")
                    .trim_start_matches('/')
                    .to_string();
                let pdl = info
                    .txt_properties
                    .get_property_val_str("pdl")
                    .unwrap_or("")
                    .to_string();
                let port = info.get_port();
                let uri = format!("ipp://{address}:{port}/{rp}");
                found.entry(uri.clone()).or_insert(Printer {
                    name: if name.is_empty() { info.get_hostname().to_string() } else { name },
                    host: info.get_hostname().to_string(),
                    address,
                    port,
                    uri,
                    pdl,
                });
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = mdns.stop_browse("_ipp._tcp.local.");
    let _ = mdns.shutdown();
    found.into_values().collect()
}

/// Get-Printer-Attributes 로 읽은 프린터 능력.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub uri: String,
    pub name: String,
    pub make_and_model: String,
    /// printer-state 3=대기 4=인쇄 중 5=정지
    pub state: Option<i32>,
    pub state_text: String,
    /// printer-resolution-supported (dpi 로 환산)
    pub resolutions_dpi: Vec<i32>,
    pub document_formats: Vec<String>,
    pub supports_pdf: bool,
    pub supports_1200: bool,
}

fn state_text(state: Option<i32>) -> String {
    match state {
        Some(3) => "대기 중".into(),
        Some(4) => "인쇄 중".into(),
        Some(5) => "정지됨 (용지·토너 확인)".into(),
        Some(n) => format!("상태 코드 {n}"),
        None => "상태 미확인".into(),
    }
}

/// 해상도 값을 dpi 로 — units 3 = dpi, 4 = dpcm.
fn resolution_dpi(v: &IppValue) -> Option<i32> {
    match v {
        IppValue::Resolution {
            cross_feed, units, ..
        } => Some(match units {
            4 => ((*cross_feed as f64) * 2.54).round() as i32,
            _ => *cross_feed,
        }),
        _ => None,
    }
}

fn flatten<'a>(v: &'a IppValue) -> Box<dyn Iterator<Item = &'a IppValue> + 'a> {
    match v {
        IppValue::Array(items) => Box::new(items.iter()),
        other => Box::new(std::iter::once(other)),
    }
}

fn parse_uri(uri: &str) -> Result<Uri, String> {
    let u = uri.trim();
    if !(u.starts_with("ipp://") || u.starts_with("ipps://")) {
        return Err("프린터 주소는 ipp://<IP>/ipp/print 형식이어야 합니다.".into());
    }
    u.parse::<Uri>()
        .map_err(|e| format!("프린터 주소가 올바르지 않습니다: {e}"))
}

fn client_for(uri: &Uri, timeout_secs: u64) -> IppClient {
    // ipps:// 주소는 TLS 검증을 유지하며 사용한다.
    IppClient::builder(uri.clone())
        .request_timeout(Duration::from_secs(timeout_secs))
        .build()
}

/// 프린터 능력 조회 — 출력 전에 "1200dpi 를 받는 프린터인가" 를 화면에 알려주기 위해.
pub fn probe(uri: &str) -> Result<PrinterInfo, String> {
    let uri_p = parse_uri(uri)?;
    let op = IppOperationBuilder::get_printer_attributes(uri_p.clone())
        .attributes([
            "printer-name",
            "printer-make-and-model",
            "printer-state",
            "printer-resolution-supported",
            "document-format-supported",
        ])
        .build()
        .map_err(|e| format!("요청 구성 실패: {e}"))?;
    let resp = client_for(&uri_p, 20)
        .send(op)
        .map_err(|e| format!("프린터에 연결하지 못했습니다: {e}"))?;
    let status = resp.header().status_code();
    if !status.is_success() {
        return Err(format!("프린터가 조회를 거절했습니다: {status}"));
    }
    let mut info = PrinterInfo {
        uri: uri.trim().to_string(),
        name: String::new(),
        make_and_model: String::new(),
        state: None,
        state_text: String::new(),
        resolutions_dpi: Vec::new(),
        document_formats: Vec::new(),
        supports_pdf: false,
        supports_1200: false,
    };
    for g in resp.attributes().groups_of(DelimiterTag::PrinterAttributes) {
        if let Some(a) = g.get("printer-name") {
            info.name = a.value().to_string();
        }
        if let Some(a) = g.get("printer-make-and-model") {
            info.make_and_model = a.value().to_string();
        }
        if let Some(a) = g.get("printer-state")
            && let IppValue::Enum(n) | IppValue::Integer(n) = a.value()
        {
            info.state = Some(*n);
        }
        if let Some(a) = g.get("printer-resolution-supported") {
            info.resolutions_dpi = flatten(a.value()).filter_map(resolution_dpi).collect();
        }
        if let Some(a) = g.get("document-format-supported") {
            info.document_formats = flatten(a.value()).map(|v| v.to_string()).collect();
        }
    }
    info.state_text = state_text(info.state);
    info.supports_pdf = info
        .document_formats
        .iter()
        .any(|f| f.eq_ignore_ascii_case("application/pdf"));
    info.supports_1200 = info.resolutions_dpi.contains(&1200);
    Ok(info)
}

/// 출력 결과 — 프린터가 실제로 기록한 해상도까지 담는다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintResult {
    pub job_id: i32,
    pub requested_dpi: i32,
    /// Get-Job-Attributes 가 돌려준 printer-resolution (없으면 프린터가 무시한 것)
    pub recorded_dpi: Option<i32>,
    /// 요청 해상도가 그대로 기록됐는가 — false 면 출력물을 그 해상도로 믿으면 안 된다
    pub verified: bool,
    /// job-state 3 pending 4 held 5 processing 6 stopped 7 canceled 8 aborted 9 completed
    pub job_state: Option<i32>,
    pub job_state_text: String,
    /// 검증 단계 설명 — 화면에 그대로 보여준다
    pub note: String,
}

fn job_state_text(state: Option<i32>) -> String {
    match state {
        Some(3) => "대기열에 들어감".into(),
        Some(4) => "보류".into(),
        Some(5) => "인쇄 중".into(),
        Some(6) => "정지됨".into(),
        Some(7) => "취소됨".into(),
        Some(8) => "중단됨".into(),
        Some(9) => "완료".into(),
        Some(n) => format!("상태 {n}"),
        None => "상태 미확인".into(),
    }
}

/// PDF 바이트를 IPP Print-Job 으로 보내고, 프린터가 기록한 해상도를 검증한다.
pub fn print_pdf(
    uri: &str,
    pdf: Vec<u8>,
    dpi: i32,
    copies: i32,
    job_name: &str,
) -> Result<PrintResult, String> {
    if dpi != 600 && dpi != 1200 {
        return Err("해상도는 600 또는 1200 dpi 만 지원합니다.".into());
    }
    if pdf.len() < 8 || !pdf.starts_with(b"%PDF") {
        return Err("PDF 파일이 아닙니다 — 다운로드가 잘못됐을 수 있습니다.".into());
    }
    let uri_p = parse_uri(uri)?;
    let attr = |name: &str, value: IppValue| {
        IppAttribute::with_name(name, value).map_err(|e| format!("속성 {name}: {e}"))
    };
    let op = IppOperationBuilder::print_job(uri_p.clone(), IppPayload::new(Cursor::new(pdf)))
        .user_name(USER_NAME)
        .job_title(job_name)
        .document_format("application/pdf")
        .attribute(attr(
            "printer-resolution",
            IppValue::new_resolution(dpi, dpi, 3),
        )?)
        .attribute(attr(
            "print-scaling",
            IppValue::new_keyword("none").map_err(|e| e.to_string())?,
        )?)
        .attribute(attr(
            "print-color-mode",
            IppValue::new_keyword("color").map_err(|e| e.to_string())?,
        )?)
        .attribute(attr("copies", IppValue::Integer(copies.clamp(1, 50)))?)
        .build()
        .map_err(|e| format!("요청 구성 실패: {e}"))?;
    let client = client_for(&uri_p, 300);
    let resp = client
        .send(op)
        .map_err(|e| format!("프린터에 보내지 못했습니다: {e}"))?;
    let status = resp.header().status_code();
    if !status.is_success() {
        return Err(format!("프린터가 출력을 거절했습니다: {status}"));
    }
    let job_id = resp
        .attributes()
        .groups_of(DelimiterTag::JobAttributes)
        .filter_map(|g| g.get("job-id"))
        .find_map(|a| match a.value() {
            IppValue::Integer(v) => Some(*v),
            _ => None,
        })
        .ok_or_else(|| "프린터가 job-id 를 돌려주지 않았습니다.".to_string())?;
    let substituted = status == StatusCode::SuccessfulOkIgnoredOrSubstitutedAttributes;

    // 검증 — 프린터 잡 레코드의 printer-resolution 이 요청과 같은가
    let mut result = PrintResult {
        job_id,
        requested_dpi: dpi,
        recorded_dpi: None,
        verified: false,
        job_state: None,
        job_state_text: String::new(),
        note: String::new(),
    };
    let chk = IppOperationBuilder::get_job_attributes(uri_p.clone(), job_id)
        .user_name(USER_NAME)
        .build()
        .map_err(|e| format!("확인 요청 구성 실패: {e}"))?;
    match client_for(&uri_p, 20).send(chk) {
        Ok(r) if r.header().status_code().is_success() => {
            for g in r.attributes().groups_of(DelimiterTag::JobAttributes) {
                if let Some(a) = g.get("printer-resolution") {
                    result.recorded_dpi = flatten(a.value()).find_map(resolution_dpi);
                }
                if let Some(a) = g.get("job-state")
                    && let IppValue::Enum(n) | IppValue::Integer(n) = a.value()
                {
                    result.job_state = Some(*n);
                }
            }
            result.verified = result.recorded_dpi == Some(dpi);
            result.note = match result.recorded_dpi {
                Some(r) if r == dpi => format!("프린터가 {dpi}dpi 로 기록했습니다 (요청과 일치)."),
                Some(r) => format!(
                    "요청은 {dpi}dpi 인데 프린터는 {r}dpi 로 기록했습니다 — 이 출력물은 {dpi}dpi 로 믿으면 안 됩니다."
                ),
                None => format!(
                    "프린터 잡 레코드에 해상도가 없습니다{} — 기본 해상도로 인쇄됐을 수 있습니다.",
                    if substituted { " (속성 일부가 무시·대체됨)" } else { "" }
                ),
            };
        }
        Ok(r) => {
            result.note = format!(
                "잡은 접수됐지만 확인 조회를 거절했습니다 ({}) — 해상도 확인 불가.",
                r.header().status_code()
            );
        }
        Err(e) => {
            result.note = format!("잡은 접수됐지만 확인 조회에 실패했습니다 ({e}) — 해상도 확인 불가.");
        }
    }
    result.job_state_text = job_state_text(result.job_state);
    Ok(result)
}

/// 프린터의 실제 작업 상태. 기록이 없으면 완료 여부를 확정하지 않는다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobStatus {
    pub job_id: i32,
    pub job_state: Option<i32>,
    pub job_state_text: String,
    /// 7·8·9 — 종료 상태
    pub done: bool,
    /// 프린터가 잡 기록을 이미 지웠다(조회 not-found)
    pub gone: bool,
    /// 지금까지 찍은 면 수 (프린터가 주면)
    pub impressions_completed: Option<i32>,
    /// `job-state-reasons` — 예: "job-printing", "media-empty"
    pub reasons: Vec<String>,
}

/// 종료 상태인가 — 완료(9)·취소(7)·실패(8).
pub fn job_state_is_done(state: Option<i32>) -> bool {
    matches!(state, Some(7) | Some(8) | Some(9))
}

pub fn job_status(uri: &str, job_id: i32) -> Result<JobStatus, String> {
    if job_id <= 0 { return Err("출력 작업 번호가 올바르지 않습니다.".into()); }
    let uri_p = parse_uri(uri)?;
    // ipp 7 의 Get-Job-Attributes 빌더엔 requested-attributes 필터가 없다 —
    // 잡 속성은 몇 개 안 되니 전부 받아서 필요한 것만 읽는다.
    let op = IppOperationBuilder::get_job_attributes(uri_p.clone(), job_id)
        .user_name(USER_NAME)
        .build()
        .map_err(|e| format!("조회 요청 구성 실패: {e}"))?;
    let resp = client_for(&uri_p, 15)
        .send(op)
        .map_err(|e| format!("프린터에 연결하지 못했습니다: {e}"))?;
    let status = resp.header().status_code();
    if status == StatusCode::ClientErrorNotFound {
        return Ok(JobStatus {
            job_id,
            job_state: None,
            job_state_text: "확인 필요 (프린터에 기록 없음)".into(),
            done: false,
            gone: true,
            impressions_completed: None,
            reasons: Vec::new(),
        });
    }
    if !status.is_success() {
        return Err(format!("프린터가 잡 조회를 거절했습니다: {status}"));
    }
    let mut out = JobStatus {
        job_id,
        job_state: None,
        job_state_text: String::new(),
        done: false,
        gone: false,
        impressions_completed: None,
        reasons: Vec::new(),
    };
    for g in resp.attributes().groups_of(DelimiterTag::JobAttributes) {
        if let Some(a) = g.get("job-state")
            && let IppValue::Enum(n) | IppValue::Integer(n) = a.value()
        {
            out.job_state = Some(*n);
        }
        if let Some(a) = g.get("job-impressions-completed")
            && let IppValue::Integer(n) = a.value()
        {
            out.impressions_completed = Some(*n);
        }
        if let Some(a) = g.get("job-state-reasons") {
            out.reasons = flatten(a.value()).map(|v| v.to_string()).collect();
        }
    }
    out.job_state_text = job_state_text(out.job_state);
    out.done = job_state_is_done(out.job_state);
    Ok(out)
}

/// ncode PDF 다운로드 (웹의 /api/download-pdf 프록시 — 호출자 인증 없음, NGS 는 서버가 대신 인증).
pub fn download(url: &str) -> Result<Vec<u8>, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("PDF 주소가 올바르지 않습니다.".into());
    }
    let mut resp = ureq::get(url)
        .call()
        .map_err(|e| format!("PDF 다운로드 실패: {e}"))?;
    let code = resp.status().as_u16();
    if code != 200 {
        return Err(format!("PDF 다운로드 실패 (HTTP {code})"));
    }
    resp.body_mut()
        .with_config()
        .limit(MAX_PDF_BYTES)
        .read_to_vec()
        .map_err(|e| format!("PDF 읽기 실패: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_must_be_ipp() {
        assert!(parse_uri("ipp://192.168.32.170/ipp/print").is_ok());
        assert!(parse_uri("ipps://printer.local:631/ipp/print").is_ok());
        assert!(parse_uri("http://192.168.32.170/ipp/print").is_err());
        assert!(parse_uri("192.168.32.170").is_err());
    }

    #[test]
    fn resolution_units() {
        assert_eq!(resolution_dpi(&IppValue::new_resolution(1200, 1200, 3)), Some(1200));
        // dpcm → dpi (236 dpcm ≈ 600 dpi)
        assert_eq!(resolution_dpi(&IppValue::new_resolution(236, 236, 4)), Some(599));
        assert_eq!(resolution_dpi(&IppValue::Integer(5)), None);
    }

    #[test]
    fn dpi_and_pdf_guard() {
        let e = print_pdf("ipp://127.0.0.1:1/ipp/print", b"%PDF-1.4 ...".to_vec(), 300, 1, "x")
            .unwrap_err();
        assert!(e.contains("600 또는 1200"));
        let e = print_pdf("ipp://127.0.0.1:1/ipp/print", b"not a pdf".to_vec(), 1200, 1, "x")
            .unwrap_err();
        assert!(e.contains("PDF 파일이 아닙니다"));
    }

    #[test]
    fn state_texts() {
        assert_eq!(job_state_text(Some(9)), "완료");
        assert_eq!(state_text(Some(5)), "정지됨 (용지·토너 확인)");
    }
}

// ---------------------------------------------------------------------------
// OS 에 등록된 프린터 — mDNS 가 못 찾을 때의 두 번째 길
// ---------------------------------------------------------------------------

/// 운영체제에 이미 설치된 프린터 하나.
///
/// # 왜 mDNS 만으로는 부족한가
///
/// `discover` 는 같은 서브넷의 `_ipp._tcp` 광고만 줍는다. 학원 공유기가 mDNS 를
/// 막거나 프린터가 다른 대역에 있으면 아무것도 안 나오고, 사용자는 IP 를 손으로
/// 쳐야 한다(사용자 요구 2026-09-04: "프린터 찾는 방식은 OS 방식 그대로 차용").
/// OS 는 이미 그 프린터를 알고 있으므로 등록된 목록을 그대로 읽어 온다.
///
/// # 직접 IPP 로 쓸 수 있는 것과 아닌 것
///
/// 우리 출력 경로는 **CUPS 큐를 건너뛰고 프린터에 직접 Print-Job** 을 던진다
/// (큐를 타면 1200dpi ncode 가 600 으로 RIP 된다). 그래서 OS 가 알려준 장치
/// 주소가 `ipp://` · `ipps://` 여야 그대로 쓸 수 있다. USB·WSD 처럼 IPP 가
/// 아닌 것은 목록에 보여 주되 `uri` 를 비워 고를 수 없게 한다 — 왜 못 쓰는지
/// 화면이 설명할 수 있어야 한다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrinter {
    /// OS 에 등록된 이름 (큐 이름)
    pub name: String,
    /// OS 가 알려준 장치 주소 원문 (`ipp://…`, `usb://…`, `WSD-…`)
    pub device: String,
    /// 직접 Print-Job 에 쓸 수 있는 `ipp://…` 주소. 못 쓰면 빈 문자열.
    pub uri: String,
    /// `dnssd://` 로 등록된 IPP 큐의 **mDNS 서비스 이름**. 주소가 아니라 이름이라
    /// 바로 못 쓰지만, [`discover`] 결과와 이름을 맞추면 IP 를 얻을 수 있다.
    /// 화면이 "네트워크 검색으로 찾을 수 있습니다" 라고 안내하는 근거.
    pub mdns_name: String,
    /// 기본 프린터인가
    pub default: bool,
}

/// `dnssd://<서비스이름>._ipp._tcp.local./…` 에서 서비스 이름을 꺼낸다.
/// IPP 계열(`_ipp`·`_ipps`)이 아니면 None — 프린터 프로토콜이 아예 다르다.
fn mdns_name_of(device: &str) -> Option<String> {
    let rest = device.strip_prefix("dnssd://")?;
    let (name, tail) = rest.split_once("._")?;
    if !(tail.starts_with("ipp._tcp") || tail.starts_with("ipps._tcp")) {
        return None;
    }
    Some(percent_decode(name))
}

/// dnssd URI 의 퍼센트 인코딩만 푼다(`%20` → 공백). 실패하면 원문 그대로.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%'
            && i + 2 < b.len()
            && let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(v);
            i += 3;
            continue;
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// 직접 사용할 수 있는 IPP 주소를 고른다. IPPS의 암호화를 낮추지 않는다.
/// 못 바꾸면 None — 화면이 "직접 출력 불가" 로 표시한다.
fn ipp_uri_from_device(device: &str) -> Option<String> {
    let d = device.trim();
    if d.starts_with("ipp://") || d.starts_with("ipps://") {
        return Some(d.to_string());
    }
    // "http://host:631/ipp/print" 로 등록된 큐도 있다 — 같은 엔드포인트다.
    if let Some(rest) = d.strip_prefix("http://").filter(|r| r.contains("/ipp")) {
        return Some(format!("ipp://{rest}"));
    }
    None
}

/// 한 줄에서 장치 URI(`scheme://…`)만 떼어낸다. 앞부분은 로케일마다 달라 못 믿는다.
fn device_uri_in(line: &str) -> Option<&str> {
    let at = line.find("://")?;
    // scheme 은 URI 앞의 영숫자·+-. 뭉치다 — 거기까지 되짚어 올라간다
    let start = line[..at]
        .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.'))
        .map(|i| i + 1)
        .unwrap_or(0);
    let uri = line[start..].trim();
    (!uri.is_empty()).then_some(uri)
}

/// macOS·리눅스: CUPS 의 `lpstat` 로 등록된 큐와 장치 주소를 읽는다.
///
/// 🚨 **`lpstat -v` 출력은 현지화된다.** 영어에선 `device for X: uri` 지만
/// 한글 macOS 는 `X에 대한 기기: uri` 다. `LC_ALL=C` 를 줘도 안 바뀐다 —
/// macOS CUPS 는 자기 번들 문자열을 쓴다. "device for " 접두를 벗기던 첫 구현은
/// 그래서 한글 맥에서 **목록을 통째로 비웠다**(2026-09-04 실측으로 잡음).
///
/// 그래서 큐 이름은 **현지화되지 않는 `lpstat -e`** 에서 얻고, `lpstat -v` 줄에서는
/// URI 만 떼어 이름과 맞춘다. 이름이 접두사로 겹칠 수 있어(`A` vs `A_2`)
/// **긴 이름부터** 맞춰 본다.
#[cfg(not(windows))]
fn read_system_printers() -> Result<Vec<SystemPrinter>, String> {
    use std::process::Command;
    let run = |args: &[&str]| -> Result<String, String> {
        let out = Command::new("lpstat")
            .args(args)
            .output()
            .map_err(|e| format!("lpstat 를 실행하지 못했습니다: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };

    // 큐 이름 — 이 출력만 현지화되지 않는다
    let names_raw = run(&["-e"])?;
    let mut names: Vec<&str> = names_raw
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    // 긴 이름부터 — "A" 가 "A_2" 줄을 먼저 채가지 않게
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));

    let devices = run(&["-v"])?;
    // 기본 프린터: "…: <이름>" — 구분자 콜론은 어느 로케일에나 있다
    let default_name = run(&["-d"])
        .ok()
        .and_then(|s| s.split_once(':').map(|(_, v)| v.trim().to_string()))
        .unwrap_or_default();

    let mut list = Vec::new();
    for line in devices.lines() {
        let Some(device) = device_uri_in(line) else {
            continue;
        };
        let head = &line[..line.len() - device.len()];
        let Some(name) = names.iter().find(|n| head.contains(**n)) else {
            continue;
        };
        list.push(SystemPrinter {
            default: !default_name.is_empty() && default_name == *name,
            uri: ipp_uri_from_device(device).unwrap_or_default(),
            mdns_name: mdns_name_of(device).unwrap_or_default(),
            name: (*name).to_string(),
            device: device.to_string(),
        });
    }
    Ok(list)
}

/// 윈도우: PowerShell `Get-Printer` 로 큐 이름·포트를 읽는다.
///
/// 포트 이름이 곧 장치 주소는 아니다 — TCP/IP 포트는 보통 `IP_192.168.0.10`
/// 이나 호스트명이라, 우리가 `ipp://<호스트>/ipp/print` 로 만들어 준다.
/// (윈도우 IPP 큐는 포트 이름 자체가 `http://…/ipp/…` 인 경우도 있다.)
#[cfg(windows)]
fn read_system_printers() -> Result<Vec<SystemPrinter>, String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let script = "Get-Printer | ForEach-Object { \
        $p = Get-PrinterPort -Name $_.PortName -ErrorAction SilentlyContinue; \
        $host2 = if ($p -and $p.PrinterHostAddress) { $p.PrinterHostAddress } else { $_.PortName }; \
        \"$($_.Name)`t$host2\" }";
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("프린터 목록을 읽지 못했습니다: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let default_name = {
        let d = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_Printer | Where-Object Default -eq $true).Name",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok();
        d.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    let mut list = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((name, device)) = line.split_once('\t') else {
            continue;
        };
        let name = name.trim().to_string();
        let device = device.trim().to_string();
        // 포트가 IP·호스트면 표준 IPP 엔드포인트를 만들어 준다
        let uri = ipp_uri_from_device(&device).unwrap_or_else(|| {
            if looks_like_host(&device) {
                format!("ipp://{device}/ipp/print")
            } else {
                String::new()
            }
        });
        list.push(SystemPrinter {
            default: !default_name.is_empty() && default_name == name,
            uri,
            mdns_name: String::new(), // 윈도우 큐는 포트가 곧 주소다
            name,
            device,
        });
    }
    Ok(list)
}

/// `192.168.0.10` · `printer.local` 처럼 붙어 볼 만한 주소인가.
/// `USB001` · `WSD-...` · `PORTPROMPT:` 같은 건 걸러낸다.
#[cfg(windows)]
fn looks_like_host(s: &str) -> bool {
    !s.is_empty()
        && !s.contains(':')
        && !s.eq_ignore_ascii_case("FILE")
        && !s.to_ascii_uppercase().starts_with("USB")
        && !s.to_ascii_uppercase().starts_with("WSD")
        && !s.to_ascii_uppercase().starts_with("LPT")
        && !s.to_ascii_uppercase().starts_with("COM")
        && !s.to_ascii_uppercase().starts_with("NUL")
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// OS 에 등록된 프린터 목록. 실패해도 빈 목록이 아니라 이유를 돌려준다 —
/// "안 나온다" 와 "못 읽었다" 는 화면에서 다르게 안내해야 한다.
pub fn system_printers() -> Result<Vec<SystemPrinter>, String> {
    let mut list = read_system_printers()?;
    // 바로 쓸 수 있는 것(ipp) 먼저, 그 안에서 기본 프린터 먼저, 그다음 이름순
    list.sort_by(|a, b| {
        // 바로 쓸 수 있는 것 → 네트워크 검색으로 찾을 수 있는 것 → 나머지
        let rank = |p: &SystemPrinter| {
            if !p.uri.is_empty() {
                0
            } else if !p.mdns_name.is_empty() {
                1
            } else {
                2
            }
        };
        rank(a)
            .cmp(&rank(b))
            .then(b.default.cmp(&a.default))
            .then(a.name.cmp(&b.name))
    });
    Ok(list)
}

#[cfg(test)]
mod system_printer_tests {
    use super::ipp_uri_from_device;

    /// CUPS 가 알려주는 주소 그대로 쓸 수 있어야 한다.
    #[test]
    fn ipp_주소는_그대로_쓴다() {
        assert_eq!(
            ipp_uri_from_device("ipp://192.168.32.170/ipp/print").as_deref(),
            Some("ipp://192.168.32.170/ipp/print")
        );
    }

    /// IPPS 주소는 포트·암호화를 그대로 유지한다.
    #[test]
    fn ipps_암호화를_유지한다() {
        assert_eq!(
            ipp_uri_from_device("ipps://printer.local:631/ipp/print").as_deref(),
            Some("ipps://printer.local:631/ipp/print")
        );
    }

    /// http 로 등록된 IPP 큐도 같은 엔드포인트다.
    #[test]
    fn http_ipp_큐도_받는다() {
        assert_eq!(
            ipp_uri_from_device("http://10.0.0.5:631/ipp/print").as_deref(),
            Some("ipp://10.0.0.5:631/ipp/print")
        );
    }

    /// 로케일마다 앞부분이 달라도 URI 는 떼어낸다 — 한글 맥에서 목록이 통째로
    /// 비던 실사고(2026-09-04). 영어/한글 두 형식을 모두 본다.
    #[test]
    fn 로케일이_달라도_장치_주소를_떼어낸다() {
        use super::device_uri_in;
        assert_eq!(
            device_uri_in("device for Foo: ipp://192.168.0.240/"),
            Some("ipp://192.168.0.240/")
        );
        assert_eq!(
            device_uri_in("Foo에 대한 기기: ipp://192.168.0.240/"),
            Some("ipp://192.168.0.240/")
        );
        assert_eq!(device_uri_in("주소가 없는 줄"), None);
    }

    /// dnssd 로 등록된 IPP 큐는 이름을 꺼내 네트워크 검색과 이어 준다.
    #[test]
    fn dnssd_ipp_는_서비스_이름을_꺼낸다() {
        use super::mdns_name_of;
        assert_eq!(
            mdns_name_of("dnssd://ApeosPort%20Print%20C3320SD._ipps._tcp.local./?uuid=x")
                .as_deref(),
            Some("ApeosPort Print C3320SD")
        );
        // 프린터 프로토콜이 다르면(_pdl-datastream) IPP 로 못 쓴다
        assert!(
            mdns_name_of("dnssd://ApeosPort-IV%20C3375._pdl-datastream._tcp.local./?bidi")
                .is_none()
        );
        assert!(mdns_name_of("ipp://192.168.0.240/").is_none());
    }

    /// 이 기계에 실제로 등록된 프린터를 찍어 본다 — 로케일·CUPS 버전마다 출력이
    /// 달라 파서가 조용히 빈 목록을 돌려주기 쉽다. CI 에는 프린터가 없으므로
    /// `cargo test -p desk-core -- --ignored --nocapture` 로 사람이 돌린다.
    #[test]
    #[ignore = "이 기계의 프린터 설정에 의존한다"]
    fn 실기계_프린터_목록을_찍어_본다() {
        match super::system_printers() {
            Ok(list) => {
                println!("등록된 프린터 {}대", list.len());
                for p in &list {
                    println!(
                        "  {:<36} uri={:<40} mdns={:<28} device={}",
                        p.name,
                        if p.uri.is_empty() { "(직접출력 불가)" } else { &p.uri },
                        if p.mdns_name.is_empty() { "-" } else { &p.mdns_name },
                        p.device
                    );
                }
                assert!(!list.is_empty(), "프린터가 하나도 안 잡혔다 — 파서를 의심할 것");
            }
            Err(e) => panic!("목록을 읽지 못했다: {e}"),
        }
    }

    /// USB·WSD 는 직접 Print-Job 을 못 던진다 — 고를 수 없게 비운다.
    #[test]
    fn usb_wsd_는_직접_출력_불가() {
        assert!(ipp_uri_from_device("usb://FUJIFILM/ApeosPort?serial=1").is_none());
        assert!(ipp_uri_from_device("WSD-1a2b3c").is_none());
        assert!(ipp_uri_from_device("http://10.0.0.5/print.html").is_none());
    }

    #[test]
    fn 작업_종료와_미확인을_구분한다() {
        assert!(super::job_state_is_done(Some(9)));
        assert!(super::job_state_is_done(Some(7)));
        assert!(super::job_state_is_done(Some(8)));
        assert!(!super::job_state_is_done(None));
        assert!(!super::job_state_is_done(Some(5)));
        assert!(super::job_status("ipps://printer.local/ipp/print", 0).is_err());
    }
}
