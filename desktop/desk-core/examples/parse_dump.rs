//! 수신 원본(T/C) 덤프 파서 — 스트로크 타임스탬프 진단용.
//! 사용: cargo run -p desk-core --example parse_dump -- <t파일> <c파일>
use postdemy_pen_core::offline;

fn main() {
    let mut args = std::env::args().skip(1);
    let t_path = args.next().expect("t 파일 경로");
    let c_path = args.next().expect("c 파일 경로");
    let t = std::fs::read(&t_path).expect("t 읽기");
    let c = std::fs::read(&c_path).expect("c 읽기");
    let opts = offline::OfflineOptions {
        max_pressure: offline::PRESSURELESS_PRESSURE,
        ..offline::OfflineOptions::default()
    };
    let note = offline::parse_offline_note(&t, &c, &opts).expect("파싱");
    println!("strokes={} skipped={}", note.strokes.len(), note.skipped_records);
    // 페이지 분포 — 전수 (샘플 출력만 보고 판단하는 사고 방지)
    let mut by_page: std::collections::BTreeMap<String, usize> = Default::default();
    for s in &note.strokes {
        *by_page.entry(format!("{:?}", s.page)).or_default() += 1;
    }
    for (p, n) in &by_page {
        println!("PAGEDIST {n:5}  {p}");
    }
    let fmt = |ms: i64| {
        let secs = ms / 1000;
        chrono::DateTime::from_timestamp(secs, 0)
            .map(|d| d.to_rfc3339())
            .unwrap_or_else(|| format!("{ms}ms"))
    };
    for (i, s) in note.strokes.iter().enumerate() {
        let first = s.dots.first().map(|d| d.timestamp_ms).unwrap_or(0);
        let last = s.dots.last().map(|d| d.timestamp_ms).unwrap_or(0);
        if i < 5 || i >= note.strokes.len().saturating_sub(5) {
            println!(
                "#{i} page {:?} dots={} start={} end={}",
                s.page, s.dots.len(), fmt(first), fmt(last)
            );
        }
    }
}
