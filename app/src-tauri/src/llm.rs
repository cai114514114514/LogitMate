//! Streaming chat against any OpenAI-compatible endpoint (DeepSeek by default, LM Studio, ...).
//!
//! Deltas go to the webview as `chat://delta` events; the API key never leaves this process.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Emitter};

pub const DEFAULT_BASE_URL: &str = "https://api.deepseek.com";
pub const DEFAULT_MODEL: &str = "deepseek-flash";

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

#[cfg(test)]
mod tests {
    use super::*;

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
