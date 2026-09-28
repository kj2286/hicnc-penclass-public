//! 웹(하이씨앤씨 펜클래스) 호환 필기 포맷 변환.
//!
//! 웹의 `Stroke` JSON(`strokes-io.ts` 의 `{version:1, strokes:[…]}` gzip)과
//! **바이트 단위로 호환**되어야 웹의 재생·AI 분석·학생 필기 기록이 그대로 동작한다.
//!
//! 규칙 세 가지는 웹 `offline-collect-model.ts` 와 동일하다:
//! - id 는 내용 기반(`off_{s}_{o}_{n}_{p}_{startedAt}_{dotCount}`) —
//!   같은 필기를 두 번 수신해도 (학생,날짜) 문서 유니온에서 접힌다.
//! - 펜 시계가 그럴듯하면(2020-01-01 이후 ~ 내일) `receivedAt = startedAt`,
//!   아니면 수신 시각으로 보정한다.
//! - 병합은 id 유니온 후 벽시계(`receivedAt ?? startedAt`) 오름차순 정렬.

use flate2::Compression;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use postdemy_pen_core::types::Stroke as CoreStroke;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

/// 웹 `Stroke.dots[]` 원소.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebDot {
    pub x: f64,
    pub y: f64,
    pub pressure: u32,
    #[serde(rename = "maxPressure")]
    pub max_pressure: u32,
    #[serde(rename = "timeStamp")]
    pub time_stamp: i64,
}

/// 웹 `Stroke`. 필드명·타입이 웹 `src/pen/live/model/stroke.ts` 와 1:1 이다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebStroke {
    pub id: String,
    pub section: u32,
    pub owner: u32,
    #[serde(rename = "noteId")]
    pub note_id: u32,
    #[serde(rename = "pageNumber")]
    pub page_number: u32,
    pub dots: Vec<WebDot>,
    #[serde(rename = "startedAt")]
    pub started_at: i64,
    #[serde(rename = "endedAt")]
    pub ended_at: Option<i64>,
    #[serde(rename = "receivedAt", skip_serializing_if = "Option::is_none")]
    pub received_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Payload {
    version: u32,
    strokes: Vec<WebStroke>,
}

/// 2020-01-01 UTC — 펜 RTC 미설정(에폭 0 등)을 걸러내는 하한 (웹과 동일).
const MIN_PLAUSIBLE_MS: i64 = 1_577_836_800_000;

fn plausible(ms: i64, now_ms: i64) -> bool {
    ms >= MIN_PLAUSIBLE_MS && ms <= now_ms + 24 * 3600 * 1000
}

/// 코어 스트로크 → 웹 스트로크. `now_ms` 는 수신 시각(시계 보정 기준).
pub fn to_web_strokes(strokes: &[CoreStroke], now_ms: i64) -> Vec<WebStroke> {
    let mut out = Vec::with_capacity(strokes.len());
    for s in strokes {
        let Some(first) = s.dots.first() else { continue };
        let Some(last) = s.dots.last() else { continue };
        let started = first.timestamp_ms;
        let ended = last.timestamp_ms;
        // ncode 소수부의 원천 해상도는 1/100 — 그 단위로 양자화해야
        // f32→f64→JSON 왕복에서 1ulp 오차 없이 무손실이다.
        let q2 = |v: f32| (f64::from(v) * 100.0).round() / 100.0;
        let dots: Vec<WebDot> = s
            .dots
            .iter()
            .map(|d| WebDot {
                x: q2(d.full_x()),
                y: q2(d.full_y()),
                pressure: u32::from(d.pressure),
                max_pressure: u32::from(d.max_pressure.max(1)),
                time_stamp: d.timestamp_ms,
            })
            .collect();
        out.push(WebStroke {
            id: format!(
                "off_{}_{}_{}_{}_{}_{}",
                s.page.section,
                s.page.owner,
                s.page.note_id,
                s.page.page_number,
                started,
                dots.len()
            ),
            section: s.page.section,
            owner: s.page.owner,
            note_id: s.page.note_id,
            page_number: s.page.page_number,
            dots,
            started_at: started,
            ended_at: Some(ended),
            received_at: Some(if plausible(started, now_ms) { started } else { now_ms }),
        });
    }
    out
}

/// 벽시계 — 병합 정렬·통계의 기준 (웹 `wallClockOf` 와 동일).
pub fn wall_clock(s: &WebStroke) -> i64 {
    s.received_at.unwrap_or(s.started_at)
}

/// 기존 저장분과 id 유니온 병합 (웹 `unionWithSaved` 와 동일 규칙).
/// 같은 id 는 나중 것(새 수신분)이 이긴다.
pub fn merge_strokes(saved: Vec<WebStroke>, incoming: Vec<WebStroke>) -> Vec<WebStroke> {
    let mut by_id: std::collections::HashMap<String, WebStroke> = std::collections::HashMap::new();
    for s in saved {
        by_id.insert(s.id.clone(), s);
    }
    for s in incoming {
        by_id.insert(s.id.clone(), s);
    }
    let mut merged: Vec<WebStroke> = by_id.into_values().collect();
    merged.sort_by_key(wall_clock);
    merged
}

/// 웹 `statsOf` 와 동일 — sp_submissions 갱신에 쓰는 통계.
#[derive(Debug, Clone, Serialize)]
pub struct Stats {
    pub stroke_count: usize,
    pub page_count: usize,
    pub duration_ms: i64,
    pub written_from: String,
    pub written_to: String,
}

pub fn stats_of(strokes: &[WebStroke]) -> Option<Stats> {
    let first = strokes.first()?;
    let last = strokes.last()?;
    let pages: std::collections::HashSet<(u32, u32, u32, u32)> = strokes
        .iter()
        .map(|s| (s.section, s.owner, s.note_id, s.page_number))
        .collect();
    let iso = |ms: i64| {
        chrono::DateTime::from_timestamp_millis(ms)
            .unwrap_or_default()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    };
    Some(Stats {
        stroke_count: strokes.len(),
        page_count: pages.len(),
        duration_ms: (wall_clock(last) - wall_clock(first)).max(0),
        written_from: iso(wall_clock(first)),
        written_to: iso(wall_clock(last)),
    })
}

/// `{version:1, strokes}` JSON → gzip 바이트 (웹 `serializeStrokes`).
pub fn serialize_gz(strokes: &[WebStroke]) -> Result<Vec<u8>, String> {
    let payload = Payload { version: 1, strokes: strokes.to_vec() };
    let json = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let mut enc = GzEncoder::new(Vec::new(), Compression::default());
    enc.write_all(&json).map_err(|e| e.to_string())?;
    enc.finish().map_err(|e| e.to_string())
}

/// gzip 바이트 → 스트로크 (웹 `deserializeStrokes`).
pub fn deserialize_gz(bytes: &[u8]) -> Result<Vec<WebStroke>, String> {
    let mut dec = GzDecoder::new(bytes);
    let mut json = Vec::new();
    dec.read_to_end(&mut json).map_err(|e| e.to_string())?;
    let payload: Payload = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    Ok(payload.strokes)
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::indexing_slicing, clippy::unwrap_used)]
mod tests {
    use super::*;
    use postdemy_pen_core::types::{Dot, NcodePage};

    fn core_stroke(ts0: i64, n: usize) -> CoreStroke {
        let page = NcodePage { section: 3, owner: 27, note_id: 605, page_number: 1 };
        let mut s = CoreStroke { page, ..Default::default() };
        for i in 0..n {
            s.dots.push(Dot {
                timestamp_ms: ts0 + i as i64 * 10,
                x: 100.0,
                y: 50.0,
                fx: 25.0, // 소수부는 1/100 카운트 — full_x = 100 + 25/100
                fy: 50.0,
                pressure: 127,
                max_pressure: 127,
                page,
                ..Default::default()
            });
        }
        s
    }

    const NOW: i64 = 1_780_000_000_000; // 2026년대 임의 시각

    #[test]
    fn id_는_내용_기반이라_재수신해도_같다() {
        let a = to_web_strokes(&[core_stroke(1_750_000_000_000, 5)], NOW);
        let b = to_web_strokes(&[core_stroke(1_750_000_000_000, 5)], NOW + 999);
        assert_eq!(a[0].id, b[0].id);
        assert_eq!(a[0].id, "off_3_27_605_1_1750000000000_5");
    }

    #[test]
    fn 펜_시계가_정상이면_received_는_started() {
        let w = to_web_strokes(&[core_stroke(1_750_000_000_000, 3)], NOW);
        assert_eq!(w[0].received_at, Some(1_750_000_000_000));
    }

    #[test]
    fn 펜_시계가_비정상이면_수신_시각으로_보정() {
        let w = to_web_strokes(&[core_stroke(12, 3)], NOW); // RTC 미설정
        assert_eq!(w[0].received_at, Some(NOW));
        assert_eq!(w[0].started_at, 12, "원본 시각은 보존");
    }

    #[test]
    fn 좌표는_정수부_더하기_소수부() {
        let w = to_web_strokes(&[core_stroke(1_750_000_000_000, 1)], NOW);
        assert!((w[0].dots[0].x - 100.25).abs() < 1e-6);
        assert!((w[0].dots[0].y - 50.5).abs() < 1e-6);
    }

    #[test]
    fn 병합은_id_유니온_후_벽시계_정렬() {
        let old = to_web_strokes(&[core_stroke(1_750_000_100_000, 2)], NOW);
        let new = to_web_strokes(
            &[core_stroke(1_750_000_000_000, 3), core_stroke(1_750_000_100_000, 2)],
            NOW,
        );
        let merged = merge_strokes(old, new);
        assert_eq!(merged.len(), 2, "중복 id 는 접힌다");
        assert!(wall_clock(&merged[0]) <= wall_clock(&merged[1]));
    }

    #[test]
    fn gzip_왕복이_무손실이다() {
        let w = to_web_strokes(&[core_stroke(1_750_000_000_000, 4)], NOW);
        let gz = serialize_gz(&w).unwrap();
        let back = deserialize_gz(&gz).unwrap();
        assert_eq!(w, back);
    }

    #[test]
    fn stats_는_웹_규칙과_같다() {
        let w = to_web_strokes(
            &[core_stroke(1_750_000_000_000, 2), core_stroke(1_750_000_060_000, 2)],
            NOW,
        );
        let st = stats_of(&w).unwrap();
        assert_eq!(st.stroke_count, 2);
        assert_eq!(st.page_count, 1);
        assert_eq!(st.duration_ms, 60_000);
        assert!(st.written_from.starts_with("2025") || st.written_from.starts_with("2026"));
    }
}
