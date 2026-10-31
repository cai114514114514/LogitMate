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

/// Shrinks a voice sample to 16 kHz mono and about 6-9 s (it is uploaded with every cloned line,
/// and a few seconds are enough to clone). Falls back to the original when afconvert fails.
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
    trim_wav(&out, 6.0, 9.0).unwrap_or(out)
}

/// Cuts 16-bit PCM WAV audio at the quietest 20 ms between `min_s` and `max_s`, so no word is cut
/// in half. None when the audio is already short enough or is not 16-bit PCM.
pub fn trim_wav(wav: &[u8], min_s: f64, max_s: f64) -> Option<Vec<u8>> {
    // Walk the RIFF chunks: afconvert adds padding chunks before "data".
    let u16_at = |i: usize| u16::from_le_bytes([wav[i], wav[i + 1]]);
    let u32_at = |i: usize| u32::from_le_bytes([wav[i], wav[i + 1], wav[i + 2], wav[i + 3]]);
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return None;
    }
    let (mut pos, mut fmt, mut data) = (12, None, None);
    while pos + 8 <= wav.len() {
        let len = u32_at(pos + 4) as usize;
        let body = pos + 8;
        match &wav[pos..pos + 4] {
            b"fmt " if body + 16 <= wav.len() => fmt = Some((u16_at(body), u16_at(body + 2), u32_at(body + 4), u16_at(body + 14))),
            b"data" => data = Some((body, len.min(wav.len() - body))),
            _ => {}
        }
        pos = body + len + (len & 1);
    }
    let ((format, channels, rate, bits), (start, len)) = (fmt?, data?);
    if format != 1 || bits != 16 || channels == 0 {
        return None;
    }
    let frame = 2 * channels as usize;
    let frames = len / frame;
    let at = |s: f64| (s * rate as f64) as usize;
    if frames <= at(max_s) {
        return None;
    }
    let window = at(0.02).max(1);
    let energy = |from: usize| -> u64 {
        (from..from + window)
            .map(|f| i16::from_le_bytes([wav[start + f * frame], wav[start + f * frame + 1]]).unsigned_abs() as u64)
            .sum()
    };
    let cut = (at(min_s)..at(max_s) - window).step_by(window).min_by_key(|&f| energy(f)).unwrap_or(at(max_s));
    let bytes = cut * frame;
    let mut out = Vec::with_capacity(44 + bytes);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + bytes as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * frame as u32).to_le_bytes());
    out.extend_from_slice(&(frame as u16).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(bytes as u32).to_le_bytes());
    out.extend_from_slice(&wav[start..start + bytes]);
    Some(out)
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

    /// A 16-bit mono WAV with a padding chunk before the data, like afconvert writes.
    fn wav(samples: &[i16], rate: u32) -> Vec<u8> {
        let data: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let mut w = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&[1, 0, 1, 0]);
        w.extend_from_slice(&rate.to_le_bytes());
        w.extend_from_slice(&(rate * 2).to_le_bytes());
        w.extend_from_slice(&[2, 0, 16, 0]);
        w.extend_from_slice(b"FLLR");
        w.extend_from_slice(&4u32.to_le_bytes());
        w.extend_from_slice(&[0; 4]);
        w.extend_from_slice(b"data");
        w.extend_from_slice(&(data.len() as u32).to_le_bytes());
        w.extend_from_slice(&data);
        w
    }

    #[test]
    fn trims_long_samples_at_a_quiet_moment() {
        let rate = 1000;
        // 12 s of loud audio with a silent gap at 7.5 s.
        let samples: Vec<i16> = (0..12 * rate).map(|i| if (7500..7600).contains(&i) { 0 } else { 8000 }).collect();
        let out = trim_wav(&wav(&samples, rate as u32), 6.0, 9.0).unwrap();
        let data_len = u32::from_le_bytes([out[40], out[41], out[42], out[43]]) as usize;
        let cut_s = data_len as f64 / 2.0 / rate as f64;
        assert!((7.5..7.6).contains(&cut_s), "cut at {cut_s}");
        assert_eq!(out.len(), 44 + data_len);
        // Short enough already, or not a WAV: left alone.
        assert!(trim_wav(&wav(&samples[..5 * rate], rate as u32), 6.0, 9.0).is_none());
        assert!(trim_wav(b"nope", 6.0, 9.0).is_none());
    }

    #[test]
    fn reads_audio_from_replies() {
        let ok = r#"{"choices":[{"message":{"role":"assistant","audio":{"data":"UklGRg=="}}}]}"#;
        assert_eq!(audio_from_response(ok).unwrap(), b"RIFF");
        assert!(audio_from_response(r#"{"choices":[{"message":{"content":"no"}}]}"#).is_err());
    }
}
