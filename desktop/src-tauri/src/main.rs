// Prevents a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the sidecar child process so it stays alive for the lifetime of the
/// app and can be killed cleanly when the user selects Quit from the tray.
struct SidecarState(Mutex<Option<CommandChild>>);

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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_tray::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            // ── Resolve data directories ───────────────────────────────────────
            let app_data = app.path().app_data_dir()?;
            let data_dir = app_data.join("data");
            let games_dir = app_data.join("games");
            std::fs::create_dir_all(&data_dir)?;
            std::fs::create_dir_all(&games_dir)?;

            // ── Pick a free port (user never sees this number) ─────────────────
            let port = find_free_port();

            // ── Spawn the Python backend sidecar ───────────────────────────────
            let (rx, child) = app
                .shell()
                .sidecar("twine-launcher-backend")?
                .args([
                    "--data-dir",
                    data_dir.to_str().unwrap_or_default(),
                    "--games-dir",
                    games_dir.to_str().unwrap_or_default(),
                    "--port",
                    &port.to_string(),
                ])
                .spawn()?;

            // Keep the child in app state so it is not dropped prematurely.
            *app.state::<SidecarState>().0.lock().unwrap() = Some(child);

            // ── Wait for the backend, then navigate the hidden window ──────────
            let handle = app.handle().clone();
            thread::spawn(move || {
                // Keep rx alive so the sidecar stdout pipe stays open.
                let _rx = rx;

                // Poll until the TCP port accepts connections (max ~30 s).
                wait_for_port(port, 60, Duration::from_millis(500));

                if let Some(window) = handle.get_webview_window("main") {
                    let url = format!("http://127.0.0.1:{}", port);
                    let _ = window.eval(&format!("window.location.replace('{}')", url));
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
                .menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        // Kill the sidecar before exiting so no orphan processes remain.
                        if let Some(child) =
                            app.state::<SidecarState>().0.lock().unwrap().take()
                        {
                            let _ = child.kill();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on the tray icon → show and focus the window.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept the close button: hide to tray instead of quitting.
            // The user exits via Quit in the tray menu, which also kills the sidecar.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Twine Launcher");
}
