//! desk-core — 크래들·BLE·웹 호환 변환 로직 (GUI 무관).
//! Tauri 커맨드(src-tauri)가 소비한다. 유닛테스트는 여기서 돈다.
pub mod ble;
pub mod ble_live;
pub mod ble_pen;
pub mod brand;
pub mod cradle;
pub mod print;
pub mod webfmt;

/// 표기 차이(콜론·대소문자)를 무시한 MAC 키 (웹 `looseMac` 과 동일 규칙).
pub fn mac_key(raw: &str) -> String {
    raw.chars()
        .filter(char::is_ascii_hexdigit)
        .collect::<String>()
        .to_ascii_lowercase()
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic)]
mod tests {
    #[test]
    fn mac_key_는_표기_차이를_무시한다() {
        assert_eq!(super::mac_key("02:00:00:AA:BB:CC"), "020000aabbcc");
        assert_eq!(super::mac_key("AABBCC"), "aabbcc");
    }
}
