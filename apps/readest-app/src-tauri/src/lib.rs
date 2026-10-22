use tauri::utils::config::BackgroundThrottlingPolicy;

use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_fs::FsExt;

mod backup_zip;
mod browser_fetch;
mod clip_url;
mod comic_parser;
mod cover_thumbnail;
mod dir_scanner;
#[cfg(any(target_os = "android", test))]
mod epub_parser;
mod localsend;
mod mobi_parser;
mod nightly_update;
mod parser_common;
mod pdf_parser;
mod range_file;
mod transfer_file;
use tauri::{command, Emitter, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "android")]
use tauri_plugin_native_bridge::register_select_directory_callback;
#[cfg(target_os = "android")]
use tauri_plugin_native_bridge::{NativeBridgeExt, OpenExternalUrlRequest};
#[cfg(not(target_os = "android"))]
use tauri_plugin_opener::OpenerExt;
use transfer_file::{download_file, upload_file};

#[cfg(any(desktop, target_os = "ios"))]
fn allow_file_in_scopes<R: tauri::Runtime>(app: &AppHandle<R>, files: Vec<PathBuf>) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    for file in &files {
        if let Err(e) = fs_scope.allow_file(file) {
            log::error!("Failed to allow file in fs_scope: {e}");
        } else {
            log::debug!("Allowed file in fs_scope: {file:?}");
        }
        if let Err(e) = asset_protocol_scope.allow_file(file) {
            log::error!("Failed to allow file in asset_protocol_scope: {e}");
        } else {
            log::debug!("Allowed file in asset_protocol_scope: {file:?}");
        }
    }
}

fn allow_dir_in_scopes<R: tauri::Runtime>(app: &AppHandle<R>, dir: &PathBuf) {
    let fs_scope = app.fs_scope();
    let asset_protocol_scope = app.asset_protocol_scope();
    if let Err(e) = fs_scope.allow_directory(dir, true) {
        log::error!("Failed to allow directory in fs_scope: {e}");
    } else {
        log::info!("Allowed directory in fs_scope: {dir:?}");
    }
    if let Err(e) = asset_protocol_scope.allow_directory(dir, true) {
        log::error!("Failed to allow directory in asset_protocol_scope: {e}");
    } else {
        log::info!("Allowed directory in asset_protocol_scope: {dir:?}");
    }
}

/// Frontend-callable shim around [`allow_file_in_scopes`] /
/// [`allow_dir_in_scopes`]. Used after dialog-based file/folder pickers
/// because the Tauri `dialog` plugin only auto-grants `fs_scope`, not
/// `asset_protocol_scope` — and our importer relies on the asset
/// protocol (`RemoteFile`) to read user-selected files. Without this,
/// importing a book from e.g. `~/Downloads/...` fails with
/// "asset protocol not configured to allow the path".
///
/// Granted scopes are persisted across app restarts thanks to
/// `tauri_plugin_persisted_scope`, so re-picking the same file isn't
/// required after the first allow call.
///
/// Security:
///
///   - On desktop, this command refuses to extend `asset_protocol_scope`
///     for any path that is not already allowed in `fs_scope`. The
///     `fs_scope` there is populated only by the Tauri `dialog` plugin
///     (when the user picks through the OS picker) or by
///     `tauri_plugin_persisted_scope` (which restores prior dialog
///     grants on startup). That gate constrains the command to
///     user-selected paths only — otherwise any frontend code
///     (including a future XSS via book content, OPDS HTML, dictionary
///     lookups, or a compromised dependency) could invoke it with an
///     arbitrary path like `/` or `~/.ssh` and gain persistent read
///     access to the entire user home directory via the asset
///     protocol.
///
///   - On iOS, the `fs_scope` gate is intentionally skipped: the iOS
///     directory/file picker (`UIDocumentPickerViewController`) does
///     not flow through Tauri's dialog plugin, and we keep the only
///     persistent record of user-authorised paths inside the
///     native-bridge plugin's security-scoped bookmark store
///     (`FolderBookmarkStore` in NativeBridgePlugin.swift). The
///     OS sandbox itself is the access-control boundary: the process
///     can only read paths for which it holds a security-scoped
///     resource (granted by the system picker, persisted via
///     bookmark). Widening Tauri's `fs_scope`/`asset_protocol_scope`
///     to those same paths cannot escalate access beyond what the OS
///     already grants — it just lets the fs / dir-scanner layers
///     route reads through the path the WebView gave them. The
///     frontend layer also keeps the list of folder roots in
///     `settings.externalLibraryFolders` and re-issues this call on
///     every launch, so the in-memory scope set stays in sync with
///     the user's persisted intent.
#[command]
fn allow_paths_in_scopes<R: tauri::Runtime>(
    _app: AppHandle<R>,
    _paths: Vec<String>,
    _is_directory: bool,
) {
    #[cfg(desktop)]
    {
        let fs_scope = _app.fs_scope();
        for raw in _paths {
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(&raw);
            if !fs_scope.is_allowed(&path) {
                log::warn!("allow_paths_in_scopes refused (path not in fs_scope): {path:?}");
                continue;
            }
            if _is_directory {
                allow_dir_in_scopes(&_app, &path);
            } else {
                allow_file_in_scopes(&_app, vec![path]);
            }
        }
    }
    #[cfg(target_os = "ios")]
    {
        // The iOS picker hands us a security-scoped URL whose POSIX
        // path lives outside any of our static fs_scope globs (e.g.
        // File Provider Storage, iCloud Drive, third-party providers).
        // Without explicitly widening fs_scope/asset_protocol_scope
        // here, both `dir_scanner::read_dir` and the fs plugin's
        // `readDir` would reject the path even though the OS sandbox
        // already grants us access via the held security-scoped
        // resource. See the security comment above.
        for raw in _paths {
            if raw.is_empty() {
                continue;
            }
            let path = PathBuf::from(&raw);
            if _is_directory {
                allow_dir_in_scopes(&_app, &path);
            } else {
                allow_file_in_scopes(&_app, vec![path]);
            }
        }
    }
    #[cfg(target_os = "android")]
    {
        // Android picker already routes through register_select_directory_callback
        // for directories; files go through SAF / content-URIs and don't use
        // asset_protocol_scope. Nothing to do here.
    }
}

#[tauri::command]
fn get_environment_variable(name: &str) -> String {
    std::env::var(String::from(name)).unwrap_or(String::from(""))
}

#[tauri::command]
fn get_executable_dir() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

// Pure decision for whether the in-app updater should be hidden. Kept
// dependency-free so it can be unit tested for every platform combination.
//
// - `env_disable`: READEST_DISABLE_UPDATER is set (explicit opt-out).
// - Linux only: Tauri's updater can self-update AppImage bundles *only*, so
//   deb/rpm/pacman (`!is_appimage`) and Flatpak installs are updated by the
//   system package manager and must not show the in-app updater.
#[cfg(desktop)]
fn compute_updater_disabled(
    env_disable: bool,
    is_linux: bool,
    is_flatpak: bool,
    is_appimage: bool,
) -> bool {
    env_disable || (is_linux && (is_flatpak || !is_appimage))
}

#[cfg(desktop)]
fn updater_disabled() -> bool {
    let env_disable = std::env::var("READEST_DISABLE_UPDATER").is_ok();
    #[cfg(target_os = "linux")]
    {
        let is_flatpak =
            std::env::var("FLATPAK_ID").is_ok() || std::path::Path::new("/.flatpak-info").exists();
        let is_appimage = std::env::var("APPIMAGE").is_ok()
            || std::env::current_exe()
                .map(|path| path.to_string_lossy().contains("/tmp/.mount_"))
                .unwrap_or(false);
        compute_updater_disabled(env_disable, true, is_flatpak, is_appimage)
    }
    #[cfg(not(target_os = "linux"))]
    {
        compute_updater_disabled(env_disable, false, false, false)
    }
}

// Authoritative source of truth for the frontend `hasUpdater` capability.
// Read via IPC in `NativeAppService.init()` so the decision does not depend on
// the injected init-script global, which is not reliably visible to page
// scripts on every Linux/WebKitGTK setup (see issue #4874).
/// The webview runtime this build drives. Named explicitly because
/// `Builder::default()` would be the type-erased `tauri::DynRuntime`.
type AppRuntime = tauri::Wry;

// The WebView engine/version for the About window's display. Only Windows
// needs the runtime query (its User-Agent is a stub); the other platforms keep
// their User-Agent-derived labels, which is why this returns `None` here.
#[derive(Clone, serde::Serialize)]
struct WebViewInfo {
    engine: String,
    version: String,
}

#[tauri::command]
fn get_webview_version() -> Option<WebViewInfo> {
    if std::env::consts::OS != "windows" {
        return None;
    }
    Some(WebViewInfo {
        engine: "WebView2".to_string(),
        version: runtime_webview_version()?,
    })
}

#[cfg(not(target_os = "linux"))]
fn runtime_webview_version() -> Option<String> {
    let version = tauri::webview_version().ok()?;
    Some(version.trim().to_string()).filter(|version| !version.is_empty())
}

#[cfg(target_os = "linux")]
fn runtime_webview_version() -> Option<String> {
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::<AppRuntime>::new();

    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tracing", log::LevelFilter::Warn)
                .level_for("tantivy", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            download_file,
            upload_file,
            get_environment_variable,
            get_executable_dir,
            get_webview_version,
            #[cfg(desktop)]
            is_updater_disabled,
            allow_paths_in_scopes,
            cover_thumbnail::optimize_cover_thumbnails,
            dir_scanner::read_dir,
            backup_zip::write_backup_zip,
            backup_zip::extract_backup_zip,
            epub_parser::parse_epub_metadata,
            epub_parser::extract_epub_cover_full,
            epub_parser::parse_epub_full,
            comic_parser::get_comic_page_sizes,
            mobi_parser::parse_mobi_metadata,
            mobi_parser::extract_mobi_cover_full,
            pdf_parser::parse_pdf_metadata,
            pdf_parser::render_pdf_cover,
            clip_url::clip_url,
            browser_fetch::fetch_web_browser_resource,
            localsend::commands::localsend_start,
            localsend::commands::localsend_stop,
            localsend::commands::localsend_get_status,
            localsend::commands::localsend_list_devices,
            localsend::commands::localsend_announce,
            localsend::commands::localsend_set_discoverable,
            localsend::commands::localsend_is_alive,
            localsend::commands::localsend_respond,
            localsend::commands::localsend_cancel_receive,
            localsend::commands::localsend_send_files,
            localsend::commands::localsend_cancel_send,
            nightly_update::verify_update_signature,
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            nightly_update::install_nightly_update,
        ])
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sharekit::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_device_info::init())
        .plugin(tauri_plugin_turso::init())
        .plugin(tauri_plugin_native_bridge::init())
        .plugin(tauri_plugin_webview_upgrade::init())
        // Serves local file byte-ranges to `RemoteFile` via `?path=&start=&end=`
        // (range-in-URL, not a `Range` header) so Android's WebView doesn't
        // re-apply the offset. Scope-gated by `asset_protocol_scope`.
        .register_asynchronous_uri_scheme_protocol(range_file::SCHEME, range_file::handle);

    let builder = builder.plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // Strip invalid geometry from the saved window state before the
    // window-state plugin loads it, so a bad `.window-state.json` (e.g. the
    // Windows minimized `-32000` sentinel) can't crash WebView2 on launch.
    // See https://github.com/readest/readest/issues/4398.
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_sign_in_with_apple::init());

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_biometric::init());

    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_webdriver::init());

    builder
        .setup(|#[allow(unused_variables)] app| {
            // When running with the webdriver feature (E2E/integration tests),
            // grant all default permissions to remote URLs (http://127.0.0.1:*)
            // so that Vitest browser-mode tests can call plugin commands.
            #[cfg(feature = "webdriver")]
            {
                use tauri::Manager;
                app.add_capability(include_str!("../capabilities-extra/webdriver.json"))?;
            }
            app.manage(localsend::LocalSendState::default());

            #[cfg(target_os = "android")]
            register_select_directory_callback(app.handle(), move |app, path| {
                allow_dir_in_scopes(app, path);
            });

            // The in-app updater is hidden for installs it can't actually update
            // (Linux deb/rpm/pacman and Flatpak) and when READEST_DISABLE_UPDATER
            // is set. This mirrors the `is_updater_disabled` command that
            // `NativeAppService.init()` reads authoritatively; the injected global
            // below is only a best-effort fast path.
            #[cfg(desktop)]
            let updater_disabled = updater_disabled();
            #[cfg(not(desktop))]
            let updater_disabled = false;

            // One id per app run. The OS keeps re-delivering the URL the app was
            // launched with — Android re-reads the sticky `activity.intent`
            // every time it recreates the Activity, iOS reloads the document
            // when WebKit recycles the WebContent process, and the deep-link
            // plugin never clears its stored URL (#6104). The webview's
            // consume-once marker therefore has to outlive the document but
            // still expire on a real relaunch, so it keys off this.
            let app_run_id = format!(
                "{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            );

            let init_script = format!(
                r#"
                    window.__READEST_APP_RUN_ID__ = "{app_run_id}";
                    if ({updater_disabled}) window.__READEST_UPDATER_DISABLED = true;
                    window.addEventListener('DOMContentLoaded', function() {{
                        document.documentElement.classList.add('edge-to-edge');
                        const isTauriLocal = window.location.protocol === 'tauri:' ||
                                            window.location.protocol === 'about:' ||
                                            window.location.hostname === 'tauri.localhost';
                        const needsSafeArea = !isTauriLocal;
                        if (needsSafeArea && !document.getElementById('safe-area-style')) {{
                            const style = document.createElement('style');
                            style.id = 'safe-area-style';
                            style.textContent = `
                                body {{
                                    padding-top: env(safe-area-inset-top) !important;
                                    padding-bottom: env(safe-area-inset-bottom) !important;
                                    padding-left: env(safe-area-inset-left) !important;
                                    padding-right: env(safe-area-inset-right) !important;
                                }}
                            `;
                            document.head.appendChild(style);
                        }}
                    }});
                "#,
                app_run_id = app_run_id,
                updater_disabled = updater_disabled
            );

            let app_handle = app.handle().clone();
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                // The window colour before the WebView paints. E-ink devices used
                // to get white here; without the device probe every platform takes
                // the dark default and the first frame matches the app's own
                // background.
                .background_color(tauri::window::Color(50, 49, 48, 255))
                .initialization_script(&init_script)
                .on_navigation(move |url| {
                    if url.scheme() == "alipays" || url.scheme() == "alipay" {
                        let url_str = url.as_str().to_string();
                        #[cfg(target_os = "android")]
                        {
                            let handle = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                match handle
                                    .native_bridge()
                                    .open_external_url(OpenExternalUrlRequest { url: url_str })
                                {
                                    Ok(result) => println!("Result: {:?}", result),
                                    Err(e) => eprintln!("Error: {:?}", e),
                                }
                            });
                        }
                        #[cfg(not(target_os = "android"))]
                        {
                            let _ = app_handle.opener().open_url(url_str, None::<&str>);
                        }
                        return false;
                    }
                    true
                });

            #[cfg(not(target_os = "macos"))]
            {
                let _main_window = win_builder.build().unwrap();
                // The window is created hidden and the state-restore show is
                // suppressed (see restore_main_window_state): the frontend
                // signals once the theme is applied — WebView2 has painted
                // the themed page — and only then is the window mapped, so
                // the user never sees the pre-theme background. The timeout
                // covers a wedged frontend by surfacing the window at its
                // fallback background (the pre-fix behavior) instead of
                // nothing. Non-Windows platforms keep their existing
                // show-at-restore behavior.
                #[cfg(windows)]
                {
                    use std::sync::atomic::{AtomicBool, Ordering};
                    use std::sync::Arc;
                    let theme_shown = Arc::new(AtomicBool::new(false));
                    if let Some(theme_window) = app.get_webview_window("main") {
                        {
                            let theme_shown = Arc::clone(&theme_shown);
                            let theme_window = theme_window.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_secs(30));
                                if !theme_shown.swap(true, Ordering::SeqCst) {
                                    log::warn!("window-themed event timed out; showing the main window at its fallback background");
                                    let _ = theme_window.show();
                                    let _ = theme_window.set_focus();
                                }
                            });
                        }
                        let theme_shown_for_listen = Arc::clone(&theme_shown);
                        let theme_window_for_listen = theme_window.clone();
                        app.listen("window-themed", move |_| {
                            if !theme_shown_for_listen.swap(true, Ordering::SeqCst) {
                                let _ = theme_window_for_listen.show();
                                let _ = theme_window_for_listen.set_focus();
                            }
                        });
                    }
                }
            }
            // let win = win_builder.build().unwrap();
            // win.open_devtools();

            app.handle().emit("window-ready", ()).unwrap();

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(
            #[allow(unused_variables)]
            |app_handle, event| {
            },
        );
}

#[cfg(all(test, desktop))]
mod tests {
    use super::compute_updater_disabled;
    #[test]
    fn env_opt_out_disables_on_any_desktop() {
        // READEST_DISABLE_UPDATER is an explicit opt-out on every desktop OS.
        assert!(compute_updater_disabled(true, false, false, false));
        assert!(compute_updater_disabled(true, true, false, true));
    }

    #[test]
    fn linux_system_package_install_is_disabled() {
        // deb/rpm/pacman installs are not AppImage and not Flatpak. Tauri's
        // Linux updater can't self-update them, so the in-app updater is hidden.
        assert!(compute_updater_disabled(false, true, false, false));
    }

    #[test]
    fn linux_flatpak_is_disabled() {
        assert!(compute_updater_disabled(false, true, true, false));
    }

    #[test]
    fn linux_appimage_keeps_updater() {
        // AppImage is the one Linux bundle Tauri can self-update.
        assert!(!compute_updater_disabled(false, true, false, true));
    }

    #[test]
    fn non_linux_desktop_keeps_updater_without_opt_out() {
        // macOS / Windows: the flatpak/appimage clause must not apply, so the
        // updater stays enabled unless the env opt-out is set.
        assert!(!compute_updater_disabled(false, false, false, false));
    }
}
