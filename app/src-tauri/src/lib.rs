mod agent_hooks;
mod agents;
mod cursor;
mod llm;
mod memory;
mod model_files;
mod profiles;
mod secrets;
mod settings;
mod tray;

use llm::{ChatMessage, ChatState};
use memory::{Memory, StoredMessage};
use settings::{Settings, SettingsStore};
use tauri::{AppHandle, Manager, State, WebviewWindow};

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

/// Streams a reply as `chat://delta` events tagged with `id`; resolves when the reply is complete.
#[tauri::command]
async fn chat_stream(
    app: AppHandle,
    chat: State<'_, ChatState>,
    store: State<'_, SettingsStore>,
    id: u32,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let s = store.get();
    let base = s.llm_base_url.unwrap_or_else(|| llm::DEFAULT_BASE_URL.into());
    let model = s.llm_model.unwrap_or_else(|| llm::DEFAULT_MODEL.into());
    let key = secrets::deepseek_key();
    if key.is_none() && base.contains("deepseek.com") {
        return Err("NO_API_KEY".into());
    }
    llm::stream_chat(&app, &chat, id, &base, &model, key, messages).await
}

/// One whole reply, for background jobs such as learning what a model's expressions mean.
/// `vision` selects the image-capable model (see `llm::vision_model`).
#[tauri::command]
async fn llm_complete(
    store: State<'_, SettingsStore>,
    messages: Vec<serde_json::Value>,
    json: bool,
    vision: bool,
) -> Result<String, String> {
    let s = store.get();
    let base = s.llm_base_url.unwrap_or_else(|| llm::DEFAULT_BASE_URL.into());
    let model = if vision {
        llm::vision_model(&base, s.llm_vision_model, s.llm_model)
    } else {
        s.llm_model.unwrap_or_else(|| llm::DEFAULT_MODEL.into())
    };
    let key = secrets::deepseek_key();
    if key.is_none() && base.contains("deepseek.com") {
        return Err("NO_API_KEY".into());
    }
    llm::complete(&base, &model, key, messages, json).await
}

/// Name of the model `llm_complete` uses for images, shown in About.
#[tauri::command]
fn llm_vision_model(store: State<SettingsStore>) -> String {
    let s = store.get();
    let base = s.llm_base_url.unwrap_or_else(|| llm::DEFAULT_BASE_URL.into());
    llm::vision_model(&base, s.llm_vision_model, s.llm_model)
}

fn profiles_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("profiles"))
}

#[tauri::command]
fn profile_load(app: AppHandle, key: String) -> Result<Option<String>, String> {
    profiles::load(&profiles_dir(&app)?, &key)
}

#[tauri::command]
fn profile_save(app: AppHandle, key: String, json: String) -> Result<(), String> {
    profiles::save(&profiles_dir(&app)?, &key, &json)
}

#[tauri::command]
fn profile_remove(app: AppHandle, key: String) -> Result<(), String> {
    profiles::remove(&profiles_dir(&app)?, &key)
}

/// Development only: writes a base64 JPEG to /tmp/logitmate-<name>.jpg so stills can be inspected.
#[tauri::command]
fn debug_save_image(name: String, base64: String) -> Result<(), String> {
    if !cfg!(debug_assertions) {
        return Ok(());
    }
    if !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("bad name".into());
    }
    let bytes = decode_base64(&base64).ok_or("bad base64")?;
    std::fs::write(format!("/tmp/logitmate-{name}.jpg"), bytes).map_err(|e| e.to_string())
}

fn decode_base64(s: &str) -> Option<Vec<u8>> {
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0);
    for b in s.bytes().filter(|b| !b.is_ascii_whitespace() && *b != b'=') {
        acc = (acc << 6) | ABC.iter().position(|&c| c == b)? as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

#[tauri::command]
fn chat_cancel(chat: State<ChatState>) {
    chat.cancel();
}

#[tauri::command]
fn has_api_key() -> bool {
    secrets::deepseek_key().is_some()
}

/// Saves a DeepSeek key to the macOS Keychain.
#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    secrets::store_deepseek_key(&key)
}

#[tauri::command]
fn memory_append(memory: State<Memory>, role: String, content: String) -> Result<(), String> {
    memory.append(&role, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_recent(memory: State<Memory>, limit: u32) -> Result<Vec<StoredMessage>, String> {
    memory.recent(limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_add_fact(memory: State<Memory>, text: String) -> Result<(), String> {
    memory.add_fact(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_facts(memory: State<Memory>, limit: u32) -> Result<Vec<String>, String> {
    memory.facts(limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn memory_forget_all(memory: State<Memory>) -> Result<(), String> {
    memory.forget_all().map_err(|e| e.to_string())
}

fn hook_paths() -> Result<agent_hooks::Paths, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(agent_hooks::Paths::from_home(std::path::Path::new(&home)))
}

#[tauri::command]
fn agents_status() -> Result<agent_hooks::HookStatus, String> {
    Ok(agent_hooks::status(&hook_paths()?))
}

/// Adds LogitMate's hook next to existing ones (Claude Code) or chains it (Codex); backs files up first.
#[tauri::command]
fn agents_connect() -> Result<agent_hooks::HookStatus, String> {
    agent_hooks::connect(&hook_paths()?)
}

#[tauri::command]
fn agents_disconnect() -> Result<agent_hooks::HookStatus, String> {
    agent_hooks::disconnect(&hook_paths()?)
}

/// Brings an agent's terminal to the front. Only known terminals, by bundle id.
#[tauri::command]
fn focus_terminal(terminal: String) -> Result<(), String> {
    let bundle = match terminal.as_str() {
        "Apple_Terminal" => "com.apple.Terminal",
        "iTerm.app" => "com.googlecode.iterm2",
        "vscode" => "com.microsoft.VSCode",
        "ghostty" => "com.mitchellh.ghostty",
        "WarpTerminal" => "dev.warp.Warp-Stable",
        "WezTerm" => "com.github.wez.wezterm",
        "Hyper" => "co.zeit.hyper",
        _ => return Err(format!("unknown terminal: {terminal}")),
    };
    std::process::Command::new("open").args(["-b", bundle]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Development only: text in /tmp/logitmate-say.txt is taken (and the file removed) as if the user
/// had typed it, so chat can be exercised from scripts. Release builds always return None.
#[tauri::command]
fn debug_take_input() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let path = std::env::temp_dir().join("logitmate-say.txt");
    let path = if path.exists() { path } else { std::path::PathBuf::from("/tmp/logitmate-say.txt") };
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    Some(text.trim().to_string()).filter(|t| !t.is_empty())
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
            chat_stream,
            chat_cancel,
            llm_complete,
            llm_vision_model,
            profile_load,
            profile_save,
            profile_remove,
            debug_save_image,
            has_api_key,
            set_api_key,
            memory_append,
            memory_recent,
            memory_add_fact,
            memory_facts,
            memory_forget_all,
            debug_take_input,
            agents_status,
            agents_connect,
            agents_disconnect,
            focus_terminal,
            log
        ])
        .setup(|app| {
            // A pet lives in the menu bar, not the Dock or the app switcher.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let dir = app.path().app_config_dir()?;
            app.manage(SettingsStore::load(dir.join("settings.json")));
            let data = app.path().app_data_dir()?;
            app.manage(Memory::open(&data.join("memory.db"))?);
            app.manage(ChatState::default());
            if let Err(e) = agents::serve(app.handle().clone(), &data.join("agent-bridge.json")) {
                eprintln!("agent bridge unavailable: {e}");
            }

            tray::create(app.handle())?;
            cursor::spawn(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_base64() {
        assert_eq!(super::decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(super::decode_base64("/9j/").unwrap(), [0xff, 0xd8, 0xff]);
        assert!(super::decode_base64("no*pe").is_none());
    }
}
