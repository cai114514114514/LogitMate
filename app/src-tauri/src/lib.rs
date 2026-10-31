mod cursor;
mod model_files;
mod settings;
mod tray;

use settings::{Settings, SettingsStore};
use tauri::{Manager, WebviewWindow};

#[tauri::command]
fn get_settings(store: tauri::State<SettingsStore>) -> Settings {
    let mut s = store.get();
    if s.model_path.is_none() {
        s.model_path = std::env::var("LOGITMATE_MODEL").ok();
    }
    s
}

#[tauri::command]
fn save_settings(store: tauri::State<SettingsStore>, settings: Settings) -> Result<(), String> {
    store.set(settings).map_err(|e| e.to_string())
}

/// Lists a model folder and lets the webview read it through the asset protocol.
#[tauri::command]
fn list_model_files(app: tauri::AppHandle, model3_path: String) -> Result<model_files::ModelFiles, String> {
    let listing = model_files::list(&model3_path)?;
    app.asset_protocol_scope()
        .allow_directory(&listing.dir, true)
        .map_err(|e| e.to_string())?;
    Ok(listing)
}

/// Click-through: true lets clicks fall through to whatever is under the pet.
#[tauri::command]
fn set_ignore_cursor(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    #[cfg(debug_assertions)]
    println!("[rust] click-through {}", if ignore { "on" } else { "off" });
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// Frontend console output, mirrored to stdout.
#[tauri::command]
fn log(level: String, text: String) {
    println!("[web:{level}] {text}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_model_files,
            set_ignore_cursor,
            log
        ])
        .setup(|app| {
            // A pet lives in the menu bar, not the Dock or the app switcher.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let dir = app.path().app_config_dir()?;
            app.manage(SettingsStore::load(dir.join("settings.json")));

            tray::create(app.handle())?;
            cursor::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
