//! Text to speech with Xiaomi MiMo: OpenAI-style chat completions that answer with audio.
//!
//! The text to speak is the assistant message; an optional user message carries natural-language
//! direction (style, emotion, or for voice design the voice itself). Three ways to pick a voice:
//! a built-in one, a voice designed from a description, or a clone of a short sample. Designing a
//! voice once and cloning that sample afterwards keeps her voice the same from line to line.

use base64::Engine;
use serde_json::{Value, json};
use std::time::Duration;

pub const BASE_URL: &str = "https://api.xiaomimimo.com/v1";
/// Built-in voices: Chinese lively girl, and an English one.
pub const DEFAULT_VOICE_ZH: &str = "冰糖";
pub const DEFAULT_VOICE_EN: &str = "Mia";

pub enum Voice {
    Preset(String),
    /// A description of the voice (age, gender, texture, pace, baseline mood).
    Design(String),
    /// A WAV sample to clone.
    Clone(Vec<u8>),
}

pub fn request_body(text: &str, direction: &str, voice: &Voice) -> Value {
    let b64 = |bytes: &[u8]| base64::engine::general_purpose::STANDARD.encode(bytes);
    let (model, audio, direction) = match voice {
        Voice::Preset(v) => ("mimo-v2.5-tts", json!({ "format": "wav", "voice": v }), direction.to_string()),
        Voice::Design(d) => ("mimo-v2.5-tts-voicedesign", json!({ "format": "wav" }), format!("{d} {direction}").trim().to_string()),
        Voice::Clone(wav) => (
            "mimo-v2.5-tts-voiceclone",
            json!({ "format": "wav", "voice": format!("data:audio/wav;base64,{}", b64(wav)) }),
            direction.to_string(),
        ),
    };
    let mut messages = Vec::new();
    if !direction.is_empty() {
        messages.push(json!({ "role": "user", "content": direction }));
    }
    messages.push(json!({ "role": "assistant", "content": text }));
    json!({ "model": model, "messages": messages, "audio": audio })
}

/// The WAV bytes in a response body.
pub fn audio_from_response(body: &str) -> Result<Vec<u8>, String> {
    let v: Value = serde_json::from_str(body).map_err(|e| format!("tts: bad response: {e}"))?;
    let data = v["choices"][0]["message"]["audio"]["data"].as_str().ok_or("tts: no audio in the reply")?;
    base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("tts: {e}"))
}

pub async fn synthesize(key: &str, text: &str, direction: &str, voice: &Voice) -> Result<Vec<u8>, String> {
    let res = reqwest::Client::new()
        .post(format!("{BASE_URL}/chat/completions"))
        .timeout(Duration::from_secs(60))
        .bearer_auth(key)
        .json(&request_body(text, direction, voice))
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;
    let status = res.status();
    let body = res.text().await.map_err(|e| format!("network: {e}"))?;
    if !status.is_success() {
        return Err(format!("{status}: {}", body.chars().take(300).collect::<String>()));
    }
    audio_from_response(&body)
}

/// Shrinks a voice sample to 16 kHz mono (it is uploaded with every cloned line). Falls back to
/// the original when afconvert is unavailable.
pub fn compact_sample(wav: &[u8]) -> Vec<u8> {
    let dir = std::env::temp_dir();
    let (src, dst) = (dir.join("logitmate-voice-in.wav"), dir.join("logitmate-voice-out.wav"));
    let converted = std::fs::write(&src, wav).is_ok()
        && std::process::Command::new("/usr/bin/afconvert")
            .args(["-f", "WAVE", "-d", "LEI16@16000", "-c", "1"])
            .arg(&src)
            .arg(&dst)
            .status()
            .is_ok_and(|s| s.success());
    let out = if converted { std::fs::read(&dst).unwrap_or_else(|_| wav.to_vec()) } else { wav.to_vec() };
    let _ = std::fs::remove_file(&src);
    let _ = std::fs::remove_file(&dst);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_requests_for_each_kind_of_voice() {
        let preset = request_body("你好呀", "(开心)", &Voice::Preset("冰糖".into()));
        assert_eq!(preset["model"], "mimo-v2.5-tts");
        assert_eq!(preset["audio"], json!({ "format": "wav", "voice": "冰糖" }));
        assert_eq!(preset["messages"], json!([{ "role": "user", "content": "(开心)" }, { "role": "assistant", "content": "你好呀" }]));

        let design = request_body("Hi", "", &Voice::Design("少女，声音清亮".into()));
        assert_eq!(design["model"], "mimo-v2.5-tts-voicedesign");
        assert_eq!(design["messages"][0], json!({ "role": "user", "content": "少女，声音清亮" }));

        let clone = request_body("Hi", "", &Voice::Clone(vec![1, 2, 3]));
        assert_eq!(clone["model"], "mimo-v2.5-tts-voiceclone");
        assert_eq!(clone["audio"]["voice"], "data:audio/wav;base64,AQID");
        assert_eq!(clone["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn reads_audio_from_replies() {
        let ok = r#"{"choices":[{"message":{"role":"assistant","audio":{"data":"UklGRg=="}}}]}"#;
        assert_eq!(audio_from_response(ok).unwrap(), b"RIFF");
        assert!(audio_from_response(r#"{"choices":[{"message":{"content":"no"}}]}"#).is_err());
    }
}
