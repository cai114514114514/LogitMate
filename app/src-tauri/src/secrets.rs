//! API keys. They are read here and used only by the Rust side; the webview never sees them.
//!
//! Lookup order: an environment variable, a `.env` file in the working directory or one of its
//! parents (development), then the macOS Keychain (what installed builds use).

use std::path::{Path, PathBuf};

const KEYCHAIN_SERVICE: &str = "com.logit.mate";

pub struct Service {
    /// Accepted variable names, compared case-insensitively.
    names: &'static [&'static str],
    keychain_account: &'static str,
}

pub const DEEPSEEK: Service = Service { names: &["DEEPSEEK_API_KEY", "DEEPSEEK_API"], keychain_account: "deepseek" };
/// Xiaomi MiMo, for text to speech.
pub const MIMO: Service = Service { names: &["MIMO_API_KEY", "MIMO_API"], keychain_account: "mimo" };

pub fn key(service: &Service) -> Option<String> {
    for name in service.names {
        if let Some(k) = std::env::var(name).ok().filter(|k| !k.trim().is_empty()) {
            return Some(k.trim().to_string());
        }
    }
    let cwd = std::env::current_dir().ok()?;
    if let Some(k) = find_dotenv(&cwd).and_then(|p| key_from_dotenv(&p, service.names)) {
        return Some(k);
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, service.keychain_account)
        .and_then(|e| e.get_password())
        .ok()
        .filter(|k| !k.is_empty())
}

pub fn deepseek_key() -> Option<String> {
    key(&DEEPSEEK)
}

pub fn store_key(service: &Service, key: &str) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, service.keychain_account)
        .and_then(|e| e.set_password(key.trim()))
        .map_err(|e| e.to_string())
}

fn find_dotenv(start: &Path) -> Option<PathBuf> {
    start.ancestors().map(|d| d.join(".env")).find(|p| p.is_file())
}

fn key_from_dotenv(path: &Path, names: &[&str]) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    parse_key(&text, names)
}

/// Finds the first accepted key name in `.env` text (`NAME=value`, optional quotes and `export`).
fn parse_key(text: &str, names: &[&str]) -> Option<String> {
    text.lines().find_map(|line| {
        let line = line.trim().trim_start_matches("export ").trim();
        let (name, value) = line.split_once('=')?;
        if line.starts_with('#') || !names.iter().any(|k| k.eq_ignore_ascii_case(name.trim())) {
            return None;
        }
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        (!value.is_empty()).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_dotenv_shapes() {
        let ds = DEEPSEEK.names;
        assert_eq!(parse_key("deepseek_api=sk-1", ds), Some("sk-1".into()));
        assert_eq!(parse_key("# c\nOTHER=x\nexport DEEPSEEK_API_KEY=\"sk-2\"\n", ds), Some("sk-2".into()));
        assert_eq!(parse_key("DEEPSEEK_API_KEY=  'sk-3' ", ds), Some("sk-3".into()));
        assert_eq!(parse_key("#DEEPSEEK_API_KEY=sk-4\nDEEPSEEK_API_KEY=", ds), None);
        assert_eq!(parse_key("OPENAI_API_KEY=sk-5", ds), None);
        assert_eq!(parse_key("deepseek_api=sk-1\nmimo_api=mm-1", MIMO.names), Some("mm-1".into()));
    }

    #[test]
    fn finds_dotenv_in_a_parent() {
        let root = std::env::temp_dir().join(format!("logitmate-env-{}", std::process::id()));
        let nested = root.join("app/src-tauri");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join(".env"), "deepseek_api=sk-x").unwrap();
        let found = find_dotenv(&nested).unwrap();
        assert_eq!(key_from_dotenv(&found, DEEPSEEK.names), Some("sk-x".into()));
        std::fs::remove_dir_all(root).ok();
    }
}
