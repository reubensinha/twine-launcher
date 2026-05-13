// Prevents a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the sidecar child process so it stays alive for the lifetime of the
/// app and can be killed cleanly when the user selects Quit from the tray.
struct SidecarState(Mutex<Option<CommandChild>>);

/// The port the backend sidecar is listening on. Stored so the open_main_window
/// helper can construct the correct URL after a window has been closed.
struct AppPort(Mutex<u16>);

/// Set to true when the user explicitly selects Quit from the tray menu.
/// ExitRequested only prevents exit when this is false (i.e. a window close).
struct ExplicitQuit(Mutex<bool>);

/// Asks the OS to assign a free port by binding to port 0, reads the assigned
/// port number, then drops the listener so the sidecar can bind it.
fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("could not bind to find a free port")
        .local_addr()
        .unwrap()
        .port()
}

/// Polls a TCP port until it accepts a connection or the attempt limit is reached.
fn wait_for_port(port: u16, max_attempts: u32, interval: Duration) {
    let addr = format!("127.0.0.1:{}", port);
    for _ in 0..max_attempts {
        if std::net::TcpStream::connect(&addr).is_ok() {
            return;
        }
        thread::sleep(interval);
    }
}

/// Show the main window, creating a fresh one if it was previously closed.
///
/// This is the Steam/Epic-style model: the library (backend + tray) is always
/// running; the window is an independent view you open and close freely.
fn open_main_window(app: &tauri::AppHandle) {
    let port = *app.state::<AppPort>().0.lock().unwrap();
    let url_str = format!("http://127.0.0.1:{}", port);

    if let Some(w) = app.get_webview_window("main") {
        // Window is still open — bring it to the front.
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.unminimize();
    } else if let Ok(url) = url_str.parse::<tauri::Url>() {
        // Window was closed — create a fresh one pointing at the running backend.
        if let Ok(w) = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
            .title("Twine Launcher")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 600.0)
            .build()
        {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[tauri::command]
fn get_games_dir(handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let app_data    = handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let config_path = handle.path().app_config_dir()
        .map_err(|e| e.to_string())?.join("sidecar-config.json");
    let custom: Option<serde_json::Value> = std::fs::read_to_string(&config_path).ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let default_games = app_data.join("games").to_string_lossy().to_string();
    Ok(serde_json::json!({
        "games_dir": custom.as_ref()
            .and_then(|c| c["games_dir"].as_str())
            .unwrap_or(&default_games),
        "default_games_dir": default_games,
    }))
}

#[tauri::command]
fn save_games_dir(games_dir: String, handle: tauri::AppHandle) -> Result<(), String> {
    let path = handle.path().app_config_dir()
        .map_err(|e| e.to_string())?.join("sidecar-config.json");
    let mut cfg: serde_json::Value = std::fs::read_to_string(&path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    cfg["games_dir"] = serde_json::json!(games_dir);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())
}

/// Returns the machine's primary LAN IP by routing a UDP socket toward 8.8.8.8
/// (no packets are actually sent). Returns None if no suitable interface exists.
fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

#[tauri::command]
fn get_network_info(handle: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let port = *handle.state::<AppPort>().0.lock().unwrap();
    let config_path = handle.path().app_config_dir()
        .map_err(|e| e.to_string())?.join("sidecar-config.json");
    let cfg: serde_json::Value = std::fs::read_to_string(&config_path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    let configured_port = cfg["external_port"].as_u64().map(|p| p as u16).unwrap_or(8080);
    let local_ip = get_local_ip();
    Ok(serde_json::json!({
        "running_port":    port,
        "configured_port": configured_port,
        "local_ip":        local_ip,
    }))
}

#[tauri::command]
fn save_external_port(port: u16, handle: tauri::AppHandle) -> Result<(), String> {
    // Verify the port is free before persisting it — but skip the check when
    // the user is re-saving the port the sidecar is already bound to, because
    // that port will appear "in use" by our own process.
    let running_port = *handle.state::<AppPort>().0.lock().unwrap();
    if port != running_port {
        std::net::TcpListener::bind(("0.0.0.0", port))
            .map_err(|_| format!("Port {} is already in use — choose a different port.", port))?;
    }
    let path = handle.path().app_config_dir()
        .map_err(|e| e.to_string())?.join("sidecar-config.json");
    let mut cfg: serde_json::Value = std::fs::read_to_string(&path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    cfg["external_port"] = serde_json::json!(port);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_external_access(handle: tauri::AppHandle) -> Result<bool, String> {
    let config_path = handle.path().app_config_dir()
        .map_err(|e| e.to_string())?.join("sidecar-config.json");
    let cfg: Option<serde_json::Value> = std::fs::read_to_string(&config_path).ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    Ok(cfg.and_then(|c| c["allow_external_access"].as_bool()).unwrap_or(false))
}

#[tauri::command]
fn save_external_access(allow: bool, handle: tauri::AppHandle) -> Result<(), String> {
    let path = handle.path().app_config_dir()
        .map_err(|e| e.to_string())?.join("sidecar-config.json");
    let mut cfg: serde_json::Value = std::fs::read_to_string(&path).ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::json!({}));
    cfg["allow_external_access"] = serde_json::json!(allow);
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(&path, cfg.to_string()).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        // Prevent a second instance from launching. A second launch attempt
        // opens (or focuses) the window in the already-running instance instead.
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            open_main_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SidecarState(Mutex::new(None)))
        .manage(AppPort(Mutex::new(0))) // real port written in setup
        .manage(ExplicitQuit(Mutex::new(false)))
        .setup(|app| {
            // ── Resolve data and games directories ────────────────────────────
            let app_data    = app.path().app_data_dir()?;
            let data_dir    = app_data.join("data"); // fixed — never user-configurable
            let config_path = app.path().app_config_dir()?.join("sidecar-config.json");

            let games_dir: std::path::PathBuf = if config_path.exists() {
                // Subsequent launch — use saved games directory.
                let raw = std::fs::read_to_string(&config_path).unwrap_or_default();
                let val: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
                val["games_dir"].as_str()
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| app_data.join("games"))
            } else {
                // No config — NSIS installer should have written one; fall back gracefully.
                let default = app_data.join("games");
                if let Some(parent) = config_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(
                    &config_path,
                    serde_json::json!({"games_dir": default.to_string_lossy().as_ref()}).to_string(),
                );
                default
            };

            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&games_dir)?;

            // ── Resolve bind host and port from config ─────────────────────────
            let startup_cfg: serde_json::Value = std::fs::read_to_string(&config_path).ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or(serde_json::json!({}));
            let allow_external = startup_cfg["allow_external_access"].as_bool().unwrap_or(false);
            let bind_host = if allow_external { "0.0.0.0" } else { "127.0.0.1" };

            // External access needs a stable port so users can bookmark/share the URL.
            // Localhost-only mode uses a random free port (user never sees the number).
            let port: u16 = if allow_external {
                let desired = startup_cfg["external_port"].as_u64().map(|p| p as u16).unwrap_or(8080);
                // Verify the port is free before handing it to the sidecar.
                // Fall back to a random port so the app still starts if something else
                // already holds the configured port; the Settings page shows running_port
                // so the user sees the correct URL and can update the setting.
                if std::net::TcpListener::bind(("0.0.0.0", desired)).is_ok() {
                    desired
                } else {
                    find_free_port()
                }
            } else {
                find_free_port()
            };
            *app.state::<AppPort>().0.lock().unwrap() = port;

            // ── Spawn the Python backend sidecar ───────────────────────────────
            let (rx, child) = app
                .shell()
                .sidecar("twine-launcher-backend")?
                .args([
                    "--host",
                    bind_host,
                    "--data-dir",
                    data_dir.to_str().unwrap_or_default(),
                    "--games-dir",
                    games_dir.to_str().unwrap_or_default(),
                    "--port",
                    &port.to_string(),
                ])
                .spawn()?;

            *app.state::<SidecarState>().0.lock().unwrap() = Some(child);

            // ── Wait for the backend, then navigate the hidden window ──────────
            let handle = app.handle().clone();
            thread::spawn(move || {
                // Keep rx alive so the sidecar stdout pipe stays open.
                let _rx = rx;

                // Show a loading screen immediately — PyInstaller one-file
                // extraction and AV scanning can make first launch slow.
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.eval(concat!(
                        "document.open('text/html');",
                        "document.write(",
                        "'<body style=\"font-family:sans-serif;padding:2rem;background:#1a1a2e;",
                        "color:#e0e0e0;display:flex;align-items:center;justify-content:center;",
                        "height:100vh;margin:0\">",
                        "<div style=\"text-align:center\">",
                        "<h2>Starting Twine Launcher...</h2>",
                        "<p style=\"color:#888\">First launch may take a minute.</p>",
                        "</div></body>'",
                        ");",
                        "document.close();"
                    ));
                    let _ = w.show();
                    let _ = w.set_focus();
                }

                // Wait up to 2 minutes — first-run extraction can be slow.
                wait_for_port(port, 240, Duration::from_millis(500));

                if let Some(window) = handle.get_webview_window("main") {
                    if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                        let url = format!("http://127.0.0.1:{}", port);
                        let _ = window.eval(&format!("window.location.replace('{}')", url));
                    } else {
                        let _ = window.eval(concat!(
                            "document.open('text/html');",
                            "document.write(",
                            "'<body style=\"font-family:sans-serif;padding:2rem;background:#1a1a2e;color:#e0e0e0\">",
                            "<h2>Twine Launcher failed to start</h2>",
                            "<p>The backend server did not start within 2 minutes.</p>",
                            "<p>Check the log for details:<br><br>",
                            "<code style=\"background:#0d0d1a;padding:4px 8px;border-radius:4px\">",
                            "%AppData%\\\\com.twinelauncher.desktop\\\\data\\\\backend.log",
                            "</code></p>",
                            "</body>'",
                            ");",
                            "document.close();"
                        ));
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            // ── System tray ────────────────────────────────────────────────────
            let show_i =
                MenuItem::with_id(app, "show", "Open Twine Launcher", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Twine Launcher")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app: &tauri::AppHandle, event| match event.id.as_ref() {
                    "show" => open_main_window(app),
                    "quit" => {
                        *app.state::<ExplicitQuit>().0.lock().unwrap() = true;
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        open_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        // No on_window_event needed: closing the window destroys the WebviewWindow
        // (like closing a browser tab). The pagehide event fires in WebView2,
        // which the frontend uses to clean up active game sessions.
        .invoke_handler(tauri::generate_handler![
            get_games_dir, save_games_dir,
            get_external_access, save_external_access,
            get_network_info, save_external_port,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Twine Launcher")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                // Window close: keep the library alive in the tray.
                // Explicit Quit from the tray menu: allow the exit through.
                if !*app.state::<ExplicitQuit>().0.lock().unwrap() {
                    api.prevent_exit();
                }
            }
            tauri::RunEvent::Exit => {
                // Explicit Quit from tray (or OS shutdown) — kill the sidecar.
                // PyInstaller --onefile spawns a two-process chain (bootloader +
                // Python interpreter); taskkill /T kills the whole tree.
                if let Some(child) = app.state::<SidecarState>().0.lock().unwrap().take() {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = std::process::Command::new("taskkill")
                            .args(["/F", "/T", "/PID", &child.pid().to_string()])
                            .output();
                    }
                    let _ = child.kill();
                }
            }
            _ => {}
        });
}
