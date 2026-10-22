use std::{
    env, fs,
    path::PathBuf,
    process::Command,
};

fn main() {
    println!("cargo:rerun-if-changed=../extensions/windows-thumbnail/src");
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        build_windows_thumbnail();
    }
    // Declare the app's own (non-plugin) commands in the ACL app manifest.
    // Since tauri 2.11, IPC from remote origins is always subject to ACL
    // resolution (upstream #15266); without a manifest the app commands have
    // no ACL entries at all and remote pages get "not allowed. Plugin not
    // found". The webdriver test harness serves the vitest tester page from
    // its own port, which is a remote origin, so it needs these permissions
    // granted via capabilities (see capabilities/webdriver-remote.json).
    // With a manifest defined, LOCAL windows also resolve app commands
    // through the ACL, so capabilities/default.json must grant them too.
    // Keep this list in sync with the generate_handler! list in lib.rs.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "download_file",
            "upload_file",
            "get_environment_variable",
            "get_executable_dir",
            "get_webview_version",
            "allow_paths_in_scopes",
            "optimize_cover_thumbnails",
            "read_dir",
            "write_backup_zip",
            "extract_backup_zip",
            "parse_epub_metadata",
            "extract_epub_cover_full",
            "parse_epub_full",
            "get_comic_page_sizes",
            "parse_mobi_metadata",
            "extract_mobi_cover_full",
            "parse_pdf_metadata",
            "render_pdf_cover",
            "clip_url",
            "fetch_web_browser_resource",
            "localsend_start",
            "localsend_stop",
            "localsend_get_status",
            "localsend_list_devices",
            "localsend_announce",
            "localsend_set_discoverable",
            "localsend_is_alive",
            "localsend_respond",
            "localsend_cancel_receive",
            "localsend_send_files",
            "localsend_cancel_send",
        ]),
    ))
    .expect("failed to run tauri-build");
}

fn build_windows_thumbnail() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dll_crate_dir = manifest_dir
        .join("..")
        .join("extensions")
        .join("windows-thumbnail");
    let dll_crate_manifest = dll_crate_dir.join("Cargo.toml");
    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());

    let mut cmd = Command::new(env::var("CARGO").unwrap_or("cargo".into()));
    cmd.arg("build")
        .arg("--package")
        .arg("windows_thumbnail")
        .arg("--manifest-path")
        .arg(&dll_crate_manifest);

    if profile == "release" {
        cmd.arg("--release");
    }

    let target_triple = env::var("TARGET").unwrap_or_default();
    let host_triple = env::var("HOST").unwrap_or_default();
    if !target_triple.is_empty() && target_triple != host_triple {
        cmd.arg("--target").arg(&target_triple);
    }

    let status = cmd
        .status()
        .expect("Failed to run cargo build for windows_thumbnail");
    if !status.success() {
        panic!("Failed to build windows_thumbnail DLL");
    }

    let dll_name = "windows_thumbnail.dll";
    let candidate_paths = [
        dll_crate_dir.join("target").join(&profile).join(dll_name),
        dll_crate_dir
            .join("target")
            .join(&target_triple)
            .join(&profile)
            .join(dll_name),
    ];

    let dll_src = candidate_paths
        .iter()
        .find(|p| p.exists())
        .expect("Failed to find built windows_thumbnail DLL");

    let dll_dest = &dll_crate_dir.join("target").join(dll_name);

    fs::copy(dll_src, dll_dest).expect("Failed to copy windows_thumbnail DLL");
    println!("cargo:rerun-if-changed={}", dll_dest.display());
}
