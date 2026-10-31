//! Agent Face: coding agents (Claude Code, Codex, Logit-Harness, ...) report what they are doing,
//! and LogitMate reacts.
//!
//! A tiny hook script POSTs each agent event to a local HTTP endpoint (127.0.0.1, random port,
//! per-launch token in agent-bridge.json). Events are reduced here to metadata — agent, project,
//! tool, what it waits for — and forwarded to the webview as `agent://event`. Prompts, code and
//! tool output are never stored or forwarded.

use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;
use tauri::{AppHandle, Emitter};

pub const ENDPOINT: &str = "/v1/agent-event";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    /// "claude-code", "codex", "loh", ...
    pub agent: String,
    pub kind: Kind,
    /// Session id when the agent provides one.
    pub session: Option<String>,
    /// Last path component of the working directory.
    pub project: Option<String>,
    pub tool: Option<String>,
    /// Short human-readable detail (the agent's own notification text, or a failure hint).
    pub detail: Option<String>,
    /// TERM_PROGRAM of the agent's terminal, to bring it to the front.
    pub terminal: Option<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    SessionStart,
    Prompt,
    ToolStart,
    ToolEnd,
    ToolFailed,
    NeedsInput,
    TurnEnd,
    SessionEnd,
}

fn project_of(cwd: Option<&str>) -> Option<String> {
    cwd.and_then(|c| Path::new(c).file_name()).map(|n| n.to_string_lossy().into_owned())
}

fn clip(s: &str, n: usize) -> String {
    let mut out: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        out.push('…');
    }
    out
}

/// Did a tool call fail? Looks only at status fields, never at content beyond a failure hint.
fn tool_failed(resp: &Value) -> bool {
    resp.get("is_error").and_then(Value::as_bool) == Some(true)
        || resp.get("interrupted").and_then(Value::as_bool) == Some(true)
        || resp.get("exit_code").or_else(|| resp.get("exitCode")).and_then(Value::as_i64).is_some_and(|c| c != 0)
}

/// Turns one raw hook payload into an event; `None` for events we do not react to.
pub fn normalize(agent: &str, terminal: Option<&str>, payload: &Value) -> Option<AgentEvent> {
    let s = |k: &str| payload.get(k).and_then(Value::as_str);
    let terminal = terminal.filter(|t| !t.is_empty()).map(str::to_string);
    let base = |kind, tool: Option<&str>, detail: Option<String>| AgentEvent {
        agent: agent.to_string(),
        kind,
        session: s("session_id").or_else(|| s("thread-id")).map(str::to_string),
        project: project_of(s("cwd")),
        tool: tool.map(str::to_string),
        detail,
        terminal: terminal.clone(),
    };

    match agent {
        // Codex `notify`: one JSON document per finished turn.
        "codex" => match s("type")? {
            "agent-turn-complete" => Some(base(Kind::TurnEnd, None, None)),
            _ => None,
        },
        // Claude Code hooks, and anything else that speaks the same shape (Logit-Harness can emit it).
        _ => match s("hook_event_name")? {
            "SessionStart" => Some(base(Kind::SessionStart, None, None)),
            "UserPromptSubmit" => Some(base(Kind::Prompt, None, None)),
            "PreToolUse" => Some(base(Kind::ToolStart, s("tool_name"), None)),
            "PostToolUse" => {
                let failed = payload.get("tool_response").is_some_and(tool_failed);
                Some(base(if failed { Kind::ToolFailed } else { Kind::ToolEnd }, s("tool_name"), None))
            }
            "Notification" => Some(base(Kind::NeedsInput, None, s("message").map(|m| clip(m, 140)))),
            "Stop" => Some(base(Kind::TurnEnd, None, None)),
            "SessionEnd" => Some(base(Kind::SessionEnd, None, None)),
            _ => None,
        },
    }
}

/// Starts the local endpoint and writes `{port, token}` to `bridge_file` (owner-only).
pub fn serve(app: AppHandle, bridge_file: &Path) -> std::io::Result<()> {
    let server = tiny_http::Server::http("127.0.0.1:0").map_err(std::io::Error::other)?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| std::io::Error::other(e.to_string()))?;
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();

    if let Some(dir) = bridge_file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(bridge_file, serde_json::json!({ "port": port, "token": token }).to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(bridge_file, std::fs::Permissions::from_mode(0o600))?;
    }

    std::thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let authorized = header(&req, "X-LogitMate-Token").as_deref() == Some(token.as_str());
            let status = if req.url() != ENDPOINT || req.method() != &tiny_http::Method::Post {
                404
            } else if !authorized {
                401
            } else {
                let agent = header(&req, "X-LogitMate-Agent").unwrap_or_else(|| "agent".into());
                let terminal = header(&req, "X-LogitMate-Term");
                let mut body = String::new();
                let _ = req.as_reader().take(1 << 20).read_to_string(&mut body);
                if let Some(ev) = serde_json::from_str::<Value>(&body)
                    .ok()
                    .and_then(|v| normalize(&agent, terminal.as_deref(), &v))
                {
                    let _ = app.emit("agent://event", ev);
                }
                204
            };
            let _ = req.respond(tiny_http::Response::empty(status));
        }
    });
    Ok(())
}

fn header(req: &tiny_http::Request, name: &'static str) -> Option<String> {
    req.headers().iter().find(|h| h.field.equiv(name)).map(|h| h.value.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_claude_code_hooks() {
        let pre = json!({"hook_event_name": "PreToolUse", "session_id": "s1", "cwd": "/Users/me/LogitMate",
                         "tool_name": "Bash", "tool_input": {"command": "secret stuff"}});
        let ev = normalize("claude-code", Some("iTerm.app"), &pre).unwrap();
        assert_eq!(ev.kind, Kind::ToolStart);
        assert_eq!(ev.project.as_deref(), Some("LogitMate"));
        assert_eq!(ev.tool.as_deref(), Some("Bash"));
        assert_eq!(ev.terminal.as_deref(), Some("iTerm.app"));
        // Tool input is never carried along.
        assert!(!serde_json::to_string(&ev).unwrap().contains("secret"));

        let failed = json!({"hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_response": {"exit_code": 1}});
        assert_eq!(normalize("claude-code", None, &failed).unwrap().kind, Kind::ToolFailed);
        let ok = json!({"hook_event_name": "PostToolUse", "tool_name": "Edit", "tool_response": {"success": true}});
        assert_eq!(normalize("claude-code", None, &ok).unwrap().kind, Kind::ToolEnd);

        let note = json!({"hook_event_name": "Notification", "message": "Claude needs your permission to use Bash"});
        let ev = normalize("claude-code", Some(""), &note).unwrap();
        assert_eq!((ev.kind, ev.detail.as_deref(), ev.terminal), (Kind::NeedsInput, Some("Claude needs your permission to use Bash"), None));

        assert_eq!(normalize("claude-code", None, &json!({"hook_event_name": "Stop"})).unwrap().kind, Kind::TurnEnd);
        assert!(normalize("claude-code", None, &json!({"hook_event_name": "PreCompact"})).is_none());
        assert!(normalize("claude-code", None, &json!({"nothing": 1})).is_none());
    }

    #[test]
    fn normalizes_codex_notify() {
        let done = json!({"type": "agent-turn-complete", "thread-id": "t9", "cwd": "/w/app",
                          "last-assistant-message": "private", "input-messages": ["private"]});
        let ev = normalize("codex", None, &done).unwrap();
        assert_eq!((ev.kind, ev.session.as_deref(), ev.project.as_deref()), (Kind::TurnEnd, Some("t9"), Some("app")));
        assert!(!serde_json::to_string(&ev).unwrap().contains("private"));
        assert!(normalize("codex", None, &json!({"type": "other"})).is_none());
    }

    #[test]
    fn clips_long_notifications() {
        let long = "x".repeat(300);
        let ev = normalize("claude-code", None, &json!({"hook_event_name": "Notification", "message": long})).unwrap();
        assert_eq!(ev.detail.unwrap().chars().count(), 141);
    }
}
