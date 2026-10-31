mod agent_hooks;
mod agents;
mod cursor;
mod front_app;
mod llm;
mod memory;
mod model_files;
mod profiles;
mod screen;
mod secrets;
mod settings;
mod tray;
mod tts;

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
    vision: Option<bool>,
) -> Result<(), String> {
    let s = store.get();
    let base = s.llm_base_url.unwrap_or_else(|| llm::DEFAULT_BASE_URL.into());
    let model = if vision == Some(true) {
        llm::vision_model(&base, s.llm_vision_model, s.llm_model)
    } else {
        s.llm_model.unwrap_or_else(|| llm::DEFAULT_MODEL.into())
    };
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

fn voice_file(app: &AppHandle, key: &str) -> Result<std::path::PathBuf, String> {
    if !(8..=64).contains(&key.len()) || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("bad voice key".into());
    }
    Ok(profiles_dir(app)?.join(format!("voice-{key}.wav")))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TtsStatus {
    available: bool,
    /// A designed voice is saved for this model.
    has_voice: bool,
}

#[tauri::command]
fn tts_status(app: AppHandle, key: String) -> Result<TtsStatus, String> {
    Ok(TtsStatus { available: secrets::key(&secrets::MIMO).is_some(), has_voice: voice_file(&app, &key)?.is_file() })
}

/// Speaks `text` (base64 WAV) in the model's saved voice, else the chosen or default built-in one.
/// `direction` is natural-language style, e.g. "(开心)".
#[tauri::command]
async fn tts_speak(
    app: AppHandle,
    store: State<'_, SettingsStore>,
    key: String,
    text: String,
    direction: String,
    zh: bool,
) -> Result<String, String> {
    use base64::Engine;
    let api_key = secrets::key(&secrets::MIMO).ok_or("NO_TTS_KEY")?;
    let voice = match std::fs::read(voice_file(&app, &key)?) {
        Ok(sample) => tts::Voice::Clone(sample),
        Err(_) => tts::Voice::Preset(
            store.get().tts_voice.unwrap_or_else(|| (if zh { tts::DEFAULT_VOICE_ZH } else { tts::DEFAULT_VOICE_EN }).into()),
        ),
    };
    let wav = tts::synthesize(&api_key, &text, &direction, &voice).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(wav))
}

/// A sample of a voice designed from `description` (base64 WAV).
#[tauri::command]
async fn tts_design(description: String, text: String) -> Result<String, String> {
    use base64::Engine;
    let api_key = secrets::key(&secrets::MIMO).ok_or("NO_TTS_KEY")?;
    let wav = tts::synthesize(&api_key, &text, "", &tts::Voice::Design(description)).await?;
    Ok(base64::engine::general_purpose::STANDARD.encode(wav))
}

/// Keeps a designed sample as the model's voice; later lines clone it.
#[tauri::command]
fn tts_save_voice(app: AppHandle, key: String, wav: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(wav.trim()).map_err(|e| e.to_string())?;
    let path = voice_file(&app, &key)?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, tts::compact_sample(&bytes)).map_err(|e| e.to_string())
}

#[tauri::command]
fn tts_remove_voice(app: AppHandle, key: String) -> Result<(), String> {
    match std::fs::remove_file(voice_file(&app, &key)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// "Look at my screen": a JPEG (base64) of the given screen rectangle in points, long side ≤ 1800 px.
/// Without Screen Recording access it asks macOS for it and fails with NO_SCREEN_ACCESS.
#[tauri::command]
async fn screen_capture(x: f64, y: f64, width: f64, height: f64) -> Result<String, String> {
    use base64::Engine;
    if !screen::has_access() {
        screen::request_access();
        return Err("NO_SCREEN_ACCESS".into());
    }
    let jpeg = tauri::async_runtime::spawn_blocking(move || screen::capture(x, y, width, height, 1800))
        .await
        .map_err(|e| e.to_string())??;
    Ok(base64::engine::general_purpose::STANDARD.encode(jpeg))
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
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64.trim()).map_err(|e| e.to_string())?;
    std::fs::write(format!("/tmp/logitmate-{name}.jpg"), bytes).map_err(|e| e.to_string())
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
    secrets::store_key(&secrets::DEEPSEEK, &key)
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

/// Name and bundle id of the frontmost app (Focus Partner); nothing else about it is read.
#[tauri::command]
fn front_app() -> Option<front_app::FrontApp> {
    front_app::frontmost()
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
            screen_capture,
            tts_status,
            tts_speak,
            tts_design,
            tts_save_voice,
            tts_remove_voice,
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
            front_app,
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
