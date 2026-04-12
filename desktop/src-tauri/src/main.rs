// Prevents a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds the sidecar child process so it stays alive for the lifetime of the
/// app and can be killed cleanly when the main window closes.
struct SidecarState(Mutex<Option<CommandChild>>);

/// Asks the OS to assign a free port by binding to port 0, reads the assigned
/// port number, then drops the listener so the sidecar can bind it.
///
/// There is a small TOCTOU window between dropping the listener and the
/// sidecar binding, but this is negligible on a desktop machine.
fn find_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("could not bind to find a free port")
        .local_addr()
        .unwrap()
        .port()
}

/// Polls TCP port until it accepts a connection or the attempt limit is reached.
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

            // Keep the child in app state so it is not dropped prematurely and
            // can be killed when the window closes.
            *app.state::<SidecarState>().0.lock().unwrap() = Some(child);

            // ── Wait for the backend, then navigate the hidden window ──────────
            let handle = app.handle().clone();
            thread::spawn(move || {
                // Keep rx alive so the sidecar stdout pipe stays open.
                // Dropping it can send EOF to the subprocess and terminate it.
                let _rx = rx;

                // Poll until the TCP port accepts connections (max ~30 s).
                wait_for_port(port, 60, Duration::from_millis(500));

                if let Some(window) = handle.get_webview_window("main") {
                    // Navigate to the backend and reveal the window.
                    let url = format!("http://127.0.0.1:{}", port);
                    let _ = window.eval(&format!("window.location.replace('{}')", url));
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Kill the sidecar process when the main window is destroyed.
            if let tauri::WindowEvent::Destroyed = event {
                if window.label() == "main" {
                    if let Some(child) = window
                        .app_handle()
                        .state::<SidecarState>()
                        .0
                        .lock()
                        .unwrap()
                        .take()
                    {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Twine Launcher");
}
