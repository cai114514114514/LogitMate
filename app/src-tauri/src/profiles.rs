//! Learned model profiles (what each expression means), cached per model in the app data folder.
//! The model folder itself is never written to.

use std::path::{Path, PathBuf};

/// Keys are hashes computed by the webview; anything else is refused, so a key can't escape `dir`.
fn file_for(dir: &Path, key: &str) -> Result<PathBuf, String> {
    let valid = (8..=64).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_hexdigit());
    if !valid {
        return Err(format!("bad profile key: {key:?}"));
    }
    Ok(dir.join(format!("{}.json", key.to_ascii_lowercase())))
}

pub fn load(dir: &Path, key: &str) -> Result<Option<String>, String> {
    match std::fs::read_to_string(file_for(dir, key)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save(dir: &Path, key: &str, json: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| format!("not JSON: {e}"))?;
    let path = file_for(dir, key)?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn remove(dir: &Path, key: &str) -> Result<(), String> {
    match std::fs::remove_file(file_for(dir, key)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_loads_and_refuses_bad_keys() {
        let dir = std::env::temp_dir().join(format!("logitmate-profiles-{}", std::process::id()));
        assert_eq!(load(&dir, "00ff00ff").unwrap(), None);
        save(&dir, "00FF00FF", r#"{"v":1}"#).unwrap();
        assert_eq!(load(&dir, "00ff00ff").unwrap().as_deref(), Some(r#"{"v":1}"#));
        assert!(save(&dir, "00ff00ff", "not json").is_err());
        for bad in ["../../etc/passwd", "short", "zzzzzzzzzz", ""] {
            assert!(load(&dir, bad).is_err(), "{bad}");
        }
        remove(&dir, "00ff00ff").unwrap();
        remove(&dir, "00ff00ff").unwrap();
        assert_eq!(load(&dir, "00ff00ff").unwrap(), None);
        std::fs::remove_dir_all(dir).ok();
    }
}
