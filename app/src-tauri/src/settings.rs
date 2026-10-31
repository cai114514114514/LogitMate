use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub model_path: Option<String>,
    /// Pet height in logical pixels; width follows the model's aspect ratio.
    pub height: Option<f64>,
    /// Window position in logical pixels.
    pub x: Option<f64>,
    pub y: Option<f64>,
    /// What she calls herself; defaults to the model's name.
    pub character_name: Option<String>,
    /// Extra persona text appended to the system prompt.
    pub persona: Option<String>,
    /// OpenAI-compatible endpoint; defaults to DeepSeek.
    pub llm_base_url: Option<String>,
    pub llm_model: Option<String>,
    /// Image-capable model for learning a model's expressions; see `llm::vision_model`.
    pub llm_vision_model: Option<String>,
    /// Speak replies aloud when a MiMo key is available (default on).
    pub speak: Option<bool>,
    /// Built-in MiMo voice when no voice has been designed for the model.
    pub tts_voice: Option<String>,
    /// Watch Over Me: she glances at the screen now and then (opt-in, default off).
    pub watch: Option<bool>,
    /// Step aside (hide) during calls and full-screen apps (default on).
    pub step_aside: Option<bool>,
}

pub struct SettingsStore {
    path: PathBuf,
    value: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let value = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, value: Mutex::new(value) }
    }

    pub fn get(&self) -> Settings {
        self.value.lock().unwrap().clone()
    }

    pub fn set(&self, settings: Settings) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&settings)?)?;
        *self.value.lock().unwrap() = settings;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_tolerates_missing_or_bad_files() {
        let dir = std::env::temp_dir().join(format!("logitmate-test-{}", std::process::id()));
        let path = dir.join("settings.json");
        assert_eq!(SettingsStore::load(path.clone()).get(), Settings::default());

        let s = Settings {
            model_path: Some("/m/a.model3.json".into()),
            height: Some(640.0),
            x: Some(10.0),
            persona: Some("话少但温柔".into()),
            ..Default::default()
        };
        SettingsStore::load(path.clone()).set(s.clone()).unwrap();
        assert_eq!(SettingsStore::load(path.clone()).get(), s);

        std::fs::write(&path, "not json").unwrap();
        assert_eq!(SettingsStore::load(path).get(), Settings::default());
        std::fs::remove_dir_all(dir).ok();
    }
}
