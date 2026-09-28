//! 학원별 앱 아이콘(화이트라벨) — 설치 후 런타임 교체.
//!
//! B2B 용도로 원장님이 올린 학원 로고를 프로그램 아이콘으로 쓴다. 설치파일에
//! 구워 넣는 아이콘은 빌드 시점에 고정되므로, **설치된 뒤 바꿀 수 있는 것들만**
//! 바꾼다:
//!
//! | 대상 | 윈도우 | 맥 |
//! |---|---|---|
//! | 창·작업표시줄 아이콘 | ✅ 런타임 교체 | (맥은 창 아이콘 개념 없음) |
//! | 바탕화면·시작메뉴 바로가기 | ✅ .lnk 아이콘 재지정 | — |
//! | Dock 아이콘 | — | ✅ 런타임 교체 |
//! | 설치파일·제어판·응용프로그램 폴더 | ❌ 빌드 시 고정 | ❌ 서명 때문에 손대면 안 됨 |
//!
//! 맥에서 .app 번들 안의 아이콘을 바꾸면 **코드 서명이 깨져 "손상됨" 으로 차단**된다
//! (ad-hoc 서명 `-` 사용). 그래서 번들은 절대 건드리지 않는다.

use std::path::{Path, PathBuf};

/// 학원 로고를 앱 아이콘으로 적용한다.
///
/// `png` 은 원본 로고(PNG). 실패해도 앱 사용에는 지장이 없어야 하므로,
/// 부분 실패는 Err 로 올리되 호출부가 무시할 수 있게 문자열 메시지만 준다.
pub fn apply_brand_icon(png: &[u8]) -> Result<PathBuf, String> {
    apply_brand_icon_in(&brand_dir()?, png)
}

/// 저장 폴더를 지정하는 버전 — 테스트가 사용자 홈을 더럽히지 않게 분리했다.
pub fn apply_brand_icon_in(dir: &Path, png: &[u8]) -> Result<PathBuf, String> {
    if png.is_empty() {
        return Err("로고 이미지가 비어 있습니다.".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("폴더 생성 실패: {e}"))?;

    // 원본 PNG 는 그대로 보관 — 창 아이콘은 PNG 로 세팅한다
    let png_path = dir.join("brand.png");
    std::fs::write(&png_path, png).map_err(|e| format!("아이콘 저장 실패: {e}"))?;

    // 윈도우 바로가기는 .ico 만 받는다
    #[cfg(target_os = "windows")]
    {
        let ico_path = dir.join("brand.ico");
        write_ico(png, &ico_path)?;
        retarget_shortcuts(&ico_path)?;
    }

    Ok(png_path)
}

/// 브랜딩 파일을 두는 폴더 (사용자별 앱 데이터)
fn brand_dir() -> Result<PathBuf, String> {
    let base = dirs_home()?;
    #[cfg(target_os = "windows")]
    let p = base.join("AppData").join("Roaming").join("HicncPenclassDesk").join("brand");
    #[cfg(not(target_os = "windows"))]
    let p = base
        .join("Library")
        .join("Application Support")
        .join("HicncPenclassDesk")
        .join("brand");
    Ok(p)
}

fn dirs_home() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let key = "USERPROFILE";
    #[cfg(not(target_os = "windows"))]
    let key = "HOME";
    std::env::var(key)
        .map(PathBuf::from)
        .map_err(|_| format!("{key} 환경변수를 읽지 못했습니다."))
}

/// PNG → ICO 변환. 윈도우 바로가기(.lnk)는 .ico 만 아이콘으로 받는다.
#[cfg(target_os = "windows")]
fn write_ico(png: &[u8], out: &Path) -> Result<(), String> {
    use image::imageops::FilterType;
    let img = image::load_from_memory(png).map_err(|e| format!("이미지를 읽지 못했습니다: {e}"))?;
    // 윈도우가 상황별로 골라 쓰도록 여러 크기를 한 파일에 담는다
    let mut icon = ico::IconDir::new(ico::ResourceType::Icon);
    for size in [16u32, 32, 48, 64, 128, 256] {
        let resized = img.resize_exact(size, size, FilterType::Lanczos3).to_rgba8();
        let entry = ico::IconImage::from_rgba_data(size, size, resized.into_raw());
        icon.add_entry(
            ico::IconDirEntry::encode(&entry).map_err(|e| format!("아이콘 인코딩 실패: {e}"))?,
        );
    }
    let file = std::fs::File::create(out).map_err(|e| format!("아이콘 파일 생성 실패: {e}"))?;
    icon.write(file).map_err(|e| format!("아이콘 쓰기 실패: {e}"))?;
    Ok(())
}

/// 바탕화면·시작메뉴 바로가기의 아이콘을 학원 로고로 다시 지정한다.
///
/// .lnk 편집은 COM(IShellLink)이 정석이지만, 의존성 없이 확실히 되는
/// WScript.Shell 을 PowerShell 로 부른다. 바로가기가 없으면 조용히 넘어간다
/// (설치 방식에 따라 만들어지지 않을 수 있다).
#[cfg(target_os = "windows")]
fn retarget_shortcuts(ico: &Path) -> Result<(), String> {
    let ico_str = ico.to_string_lossy().replace('\'', "''");
    // **이름이 아니라 가리키는 대상으로 찾는다.** 제품명이 한글("하이씨앤씨 펜클래스")이라
    // 이름으로 거르면 PowerShell 인자 인코딩에 기대게 되고, 사용자가 바로가기 이름을
    // 바꾸면 놓친다. 우리 exe 를 가리키는 .lnk 면 그게 우리 바로가기다.
    let exe = std::env::current_exe()
        .map_err(|e| format!("실행 파일 경로를 알 수 없습니다: {e}"))?;
    let exe_str = exe.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
$ErrorActionPreference='SilentlyContinue'
$ico='{ico}'
$exe='{exe}'
$sh=New-Object -ComObject WScript.Shell
$paths=@(
  [Environment]::GetFolderPath('Desktop'),
  [Environment]::GetFolderPath('Programs'),
  [Environment]::GetFolderPath('CommonDesktopDirectory'),
  [Environment]::GetFolderPath('CommonPrograms')
)
foreach ($p in $paths) {{
  if (-not $p) {{ continue }}
  Get-ChildItem -Path $p -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {{
    $lnk=$sh.CreateShortcut($_.FullName)
    if ($lnk.TargetPath -ieq $exe) {{
      $lnk.IconLocation=$ico
      $lnk.Save()
    }}
  }}
}}
"#,
        ico = ico_str,
        exe = exe_str
    );
    // CREATE_NO_WINDOW — 없으면 실행 순간 검은 콘솔 창이 뜬다(크래들 폴링에서
    // 같은 증상으로 실사고, 2026-08-17).
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x0800_0000)
        .output()
        .map_err(|e| format!("바로가기 아이콘 변경 실패: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "바로가기 아이콘 변경 실패: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(())
}

/// 적용해 둔 브랜드 아이콘 경로 (없으면 None) — 앱 시작 시 복원용
pub fn saved_brand_icon() -> Option<PathBuf> {
    saved_brand_icon_in(&brand_dir().ok()?)
}

pub fn saved_brand_icon_in(dir: &Path) -> Option<PathBuf> {
    let p = dir.join("brand.png");
    if p.is_file() {
        Some(p)
    } else {
        None
    }
}

/// 브랜딩 해제 — 기본 아이콘으로 되돌린다
pub fn clear_brand_icon() -> Result<(), String> {
    clear_brand_icon_in(&brand_dir()?)
}

pub fn clear_brand_icon_in(dir: &Path) -> Result<(), String> {
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| format!("브랜딩 제거 실패: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 빈_이미지는_거부한다() {
        assert!(apply_brand_icon(&[]).is_err());
    }

    #[test]
    fn 브랜드_폴더는_사용자_경로_아래다() {
        let d = brand_dir().expect("brand dir");
        assert!(d.ends_with("brand"), "{d:?}");
        assert!(d.to_string_lossy().contains("HicncPenclassDesk"), "{d:?}");
    }

    /// 로고를 적용하면 **실제로 파일이 써지고**, 해제하면 사라진다.
    /// (아이콘이 저장돼야 앱을 껐다 켜도 학원 로고가 유지된다)
    #[test]
    fn 로고를_적용하면_저장되고_해제하면_사라진다() {
        let tmp = std::env::temp_dir().join(format!("penclass-brand-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        // 1x1 투명 PNG — 저장 여부만 보므로 내용은 최소로
        let png: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        assert!(saved_brand_icon_in(&tmp).is_none(), "적용 전에는 저장된 아이콘이 없다");

        let saved = apply_brand_icon_in(&tmp, png).expect("적용 성공");
        assert!(saved.is_file(), "PNG 가 실제로 저장돼야 한다: {saved:?}");
        assert_eq!(std::fs::read(&saved).unwrap(), png, "저장 내용이 원본과 같아야 한다");
        assert!(saved_brand_icon_in(&tmp).is_some(), "복원용 조회가 되어야 한다");

        clear_brand_icon_in(&tmp).expect("해제 성공");
        assert!(saved_brand_icon_in(&tmp).is_none(), "해제하면 기본 아이콘으로 돌아간다");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
