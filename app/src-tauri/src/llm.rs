//! Streaming chat against any OpenAI-compatible endpoint (DeepSeek by default, LM Studio, ...).
//!
//! Deltas go to the webview as `chat://delta` events; the API key never leaves this process.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
pub const DEFAULT_MODEL: &str = "deepseek-flash";
/// DeepSeek's model that accepts images (deepseek-v4-pro silently drops them).
pub const DEEPSEEK_VISION_MODEL: &str = "deepseek-flash";

/// The model used when a request carries images: an explicit setting, else DeepSeek's vision
/// model on DeepSeek, else the chat model (local servers usually serve one model for both).
pub fn vision_model(base_url: &str, vision: Option<String>, chat: Option<String>) -> String {
    vision
        .filter(|m| !m.trim().is_empty())
        .or_else(|| base_url.contains("deepseek.com").then(|| DEEPSEEK_VISION_MODEL.to_string()))
        .or(chat)
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Clone)]
struct Delta<'a> {
    id: u32,
    text: &'a str,
}

/// The request that may still stream; starting a new one or cancelling silences older ones.
#[derive(Default)]
pub struct ChatState {
    current: AtomicU32,
}

impl ChatState {
    pub fn cancel(&self) {
        self.current.store(0, Ordering::SeqCst);
    }
}

#[derive(Debug, PartialEq)]
pub enum SseEvent {
    Content(String),
    Done,
}

/// Parses one SSE line from a chat-completions stream. Reasoning deltas are skipped.
pub fn parse_sse_line(line: &str) -> Option<SseEvent> {
    let data = line.strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return Some(SseEvent::Done);
    }
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let text = v["choices"][0]["delta"]["content"].as_str()?;
    (!text.is_empty()).then(|| SseEvent::Content(text.to_string()))
}

pub async fn stream_chat(
    app: &AppHandle,
    state: &ChatState,
    id: u32,
    base_url: &str,
    model: &str,
    api_key: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    state.current.store(id, Ordering::SeqCst);
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut req = reqwest::Client::new()
        .post(&url)
        .json(&serde_json::json!({ "model": model, "stream": true, "messages": messages }));
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| format!("network: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("{status}: {}", body.chars().take(300).collect::<String>()));
    }

    let mut stream = res.bytes_stream();
    // Bytes, not text: a multi-byte character can be split across network chunks.
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = stream.next().await {
        if state.current.load(Ordering::SeqCst) != id {
            return Ok(()); // cancelled or superseded
        }
        buf.extend_from_slice(&chunk.map_err(|e| format!("network: {e}"))?);
        while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=nl).collect();
            match parse_sse_line(String::from_utf8_lossy(&line).trim()) {
                Some(SseEvent::Content(text)) => {
                    let _ = app.emit("chat://delta", Delta { id, text: &text });
                }
                Some(SseEvent::Done) => return Ok(()),
                None => {}
            }
        }
    }
    Ok(())
}

/// One whole (non-streaming) reply, for background jobs. Messages pass through as JSON, so they
/// may carry image parts. With `json`, asks for a JSON object. Returns the reply without reasoning.
pub async fn complete(
    base_url: &str,
    model: &str,
    api_key: Option<String>,
    messages: Vec<serde_json::Value>,
    json: bool,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({ "model": model, "messages": messages });
    if json {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    let mut req = reqwest::Client::new().post(&url).timeout(Duration::from_secs(240)).json(&body);
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }
    let res = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| format!("network: {e}"))?;
    if !status.is_success() {
        return Err(format!("{status}: {}", text.chars().take(300).collect::<String>()));
    }
    reply_text(&text)
}

/// The assistant text of a chat-completions response body.
pub fn reply_text(body: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(body).map_err(|e| format!("api: bad response: {e}"))?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .filter(|t| !t.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "api: empty reply".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_a_vision_model() {
        let ds = DEFAULT_BASE_URL;
        assert_eq!(vision_model(ds, None, Some("deepseek-v4-pro".into())), "deepseek-flash");
        assert_eq!(vision_model(ds, Some("my-vl".into()), None), "my-vl");
        assert_eq!(vision_model(ds, Some(" ".into()), None), "deepseek-flash");
        assert_eq!(vision_model("http://localhost:1234/v1", None, Some("qwen3-vl".into())), "qwen3-vl");
        assert_eq!(vision_model("http://localhost:1234/v1", None, None), DEFAULT_MODEL);
    }

    #[test]
    fn reads_reply_text() {
        let ok = r#"{"choices":[{"message":{"content":"{\"a\":1}","reasoning_content":"..."}}]}"#;
        assert_eq!(reply_text(ok).unwrap(), r#"{"a":1}"#);
        assert!(reply_text(r#"{"choices":[{"message":{"content":""}}]}"#).is_err());
        assert!(reply_text("oops").is_err());
    }

    #[test]
    fn parses_stream_lines() {
        let content = r#"data: {"choices":[{"delta":{"content":"[emo:happy] 你好"}}]}"#;
        assert_eq!(parse_sse_line(content), Some(SseEvent::Content("[emo:happy] 你好".into())));
        let reasoning = r#"data: {"choices":[{"delta":{"reasoning_content":"hmm","content":""}}]}"#;
        assert_eq!(parse_sse_line(reasoning), None);
        assert_eq!(parse_sse_line("data: [DONE]"), Some(SseEvent::Done));
        assert_eq!(parse_sse_line(": keep-alive"), None);
        assert_eq!(parse_sse_line(""), None);
    }
}
