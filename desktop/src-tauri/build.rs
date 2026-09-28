fn main() {
    // 앱 커맨드별 allow-* permission 을 생성한다 — 원격 URL(선생님 웹) 창은
    // 명시 허용된 커맨드만 부를 수 있다 (capabilities/main.json 에서 참조).
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "cradle_snapshot",
            "cradle_probe",
            "cradle_pull",
            "cradle_erase",
            "ble_scan_pens",
            "ble_pull_pen",
            "ble_live_start",
            "ble_live_start_mac",
            "ble_live_stop",
            "ble_live_active",
            "ble_rename",
            "print_page",
            "print_discover",
            "print_system_printers",
            "print_probe",
            "print_ncode",
            "print_job_status",
            "save_pdf",
            "open_receive_dir",
            "apply_brand_icon",
            "clear_brand_icon",
        ])),
    )
    .expect("tauri build");
}
