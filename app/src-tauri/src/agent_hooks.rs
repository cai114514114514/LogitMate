//! Connects coding agents to LogitMate by adding (never replacing) hook entries.
//!
//! - Claude Code: one more hook group per event in ~/.claude/settings.json, next to existing ones.
//! - Codex: `notify` allows a single command, so ours runs first and then execs the previous one.
//!
//! Every change is idempotent, reversible, and preceded by a timestamped backup of the file.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MARKER: &str = "logitmate-hook";

pub const HOOK_SCRIPT: &str = r#"#!/bin/sh
# LogitMate agent hook: forwards coding-agent events to LogitMate. Installed by LogitMate.
# It never blocks or fails the calling agent: the POST runs in the background with a short
# timeout, and nothing happens when LogitMate is not running.
#   logitmate-hook claude-code                 hook JSON on stdin (any agent name works the same)
#   logitmate-hook codex <json>                Codex notify
#   logitmate-hook codex-chain <cmd...> <json> Codex notify, then the previous notify command
agent="$1"; [ $# -gt 0 ] && shift
bridge="$HOME/Library/Application Support/com.logit.mate/agent-bridge.json"
send() {
  [ -f "$bridge" ] || return 0
  port=$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "$bridge")
  token=$(sed -n 's/.*"token":"\([0-9a-f]*\)".*/\1/p' "$bridge")
  [ -n "$port" ] || return 0
  printf '%s' "$1" | curl -s -m 0.5 -o /dev/null -X POST \
    -H "X-LogitMate-Token: $token" -H "X-LogitMate-Agent: $2" -H "X-LogitMate-Term: ${TERM_PROGRAM:-}" \
    --data-binary @- "http://127.0.0.1:$port/v1/agent-event" >/dev/null 2>&1 &
}
case "$agent" in
  codex) for last; do :; done; send "$last" codex ;;
  codex-chain) for last; do :; done; send "$last" codex; exec "$@" ;;
  *) send "$(cat)" "$agent" ;;
esac
exit 0
"#;

/// Claude Code events we listen to; tool events need a matcher.
const CLAUDE_EVENTS: &[(&str, bool)] = &[
    ("SessionStart", false),
    ("UserPromptSubmit", false),
    ("PreToolUse", true),
    ("PostToolUse", true),
    ("Notification", false),
    ("Stop", false),
    ("SessionEnd", false),
];

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub claude_installed: bool,
    pub claude_connected: bool,
    pub codex_installed: bool,
    pub codex_connected: bool,
}

pub struct Paths {
    pub script: PathBuf,
    pub claude_settings: PathBuf,
    pub codex_config: PathBuf,
}

impl Paths {
    pub fn from_home(home: &Path) -> Self {
        Self {
            script: home.join(".logitmate/bin/logitmate-hook"),
            claude_settings: home.join(".claude/settings.json"),
            codex_config: home.join(".codex/config.toml"),
        }
    }
}

fn is_ours(command: &str) -> bool {
    command.contains(MARKER)
}

// ---- Claude Code (settings.json) ----

pub fn claude_connect(settings: &str, script: &str) -> Result<String, String> {
    let mut root: Value = if settings.trim().is_empty() { json!({}) } else { serde_json::from_str(settings).map_err(|e| e.to_string())? };
    let hooks = root
        .as_object_mut()
        .ok_or("settings.json is not an object")?
        .entry("hooks")
        .or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" is not an object")?;
    let command = format!("'{script}' claude-code");
    for (event, tool) in CLAUDE_EVENTS {
        let groups = hooks.entry(*event).or_insert_with(|| json!([]));
        let groups = groups.as_array_mut().ok_or(format!("hooks.{event} is not a list"))?;
        let present = groups.iter().any(|g| {
            g["hooks"].as_array().is_some_and(|hs| hs.iter().any(|h| h["command"].as_str().is_some_and(is_ours)))
        });
        if !present {
            let mut group = json!({ "hooks": [{ "type": "command", "command": command }] });
            if *tool {
                group["matcher"] = json!("*");
            }
            groups.push(group);
        }
    }
    serde_json::to_string_pretty(&root).map(|s| s + "\n").map_err(|e| e.to_string())
}

pub fn claude_disconnect(settings: &str) -> Result<String, String> {
    let mut root: Value = serde_json::from_str(settings).map_err(|e| e.to_string())?;
    if let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) {
        for (_, groups) in hooks.iter_mut() {
            if let Some(groups) = groups.as_array_mut() {
                for g in groups.iter_mut() {
                    if let Some(hs) = g.get_mut("hooks").and_then(Value::as_array_mut) {
                        hs.retain(|h| !h["command"].as_str().is_some_and(is_ours));
                    }
                }
                groups.retain(|g| g["hooks"].as_array().is_none_or(|hs| !hs.is_empty()));
            }
        }
        hooks.retain(|_, groups| groups.as_array().is_none_or(|g| !g.is_empty()));
    }
    serde_json::to_string_pretty(&root).map(|s| s + "\n").map_err(|e| e.to_string())
}

pub fn claude_is_connected(settings: &str) -> bool {
    settings.contains(MARKER)
}

// ---- Codex (config.toml) ----

pub fn codex_connect(config: &str, script: &str) -> Result<String, String> {
    let mut doc: toml_edit::DocumentMut = config.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
    let previous: Vec<String> = doc
        .get("notify")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if previous.first().is_some_and(|c| is_ours(c)) {
        return Ok(config.to_string());
    }
    let mut notify = toml_edit::Array::new();
    notify.push(script);
    if previous.is_empty() {
        notify.push("codex");
    } else {
        notify.push("codex-chain");
        for p in &previous {
            notify.push(p.as_str());
        }
    }
    doc["notify"] = toml_edit::value(notify);
    Ok(doc.to_string())
}

pub fn codex_disconnect(config: &str) -> Result<String, String> {
    let mut doc: toml_edit::DocumentMut = config.parse().map_err(|e: toml_edit::TomlError| e.to_string())?;
    let current: Vec<String> = doc
        .get("notify")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if !current.first().is_some_and(|c| is_ours(c)) {
        return Ok(config.to_string());
    }
    if current.get(1).map(String::as_str) == Some("codex-chain") && current.len() > 2 {
        let mut notify = toml_edit::Array::new();
        for p in &current[2..] {
            notify.push(p.as_str());
        }
        doc["notify"] = toml_edit::value(notify);
    } else {
        doc.remove("notify");
    }
    Ok(doc.to_string())
}

pub fn codex_is_connected(config: &str) -> bool {
    config.parse::<toml_edit::DocumentMut>().ok().is_some_and(|d| {
        d.get("notify").and_then(|v| v.as_array()).and_then(|a| a.get(0)).and_then(|v| v.as_str()).is_some_and(is_ours)
    })
}

// ---- Files ----

fn backup(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let name = format!("{}.logitmate-backup-{ts}", path.file_name().unwrap_or_default().to_string_lossy());
        std::fs::copy(path, path.with_file_name(name))?;
    }
    Ok(())
}

fn rewrite(path: &Path, f: impl FnOnce(&str) -> Result<String, String>) -> Result<(), String> {
    let old = std::fs::read_to_string(path).unwrap_or_default();
    let new = f(&old)?;
    if new != old {
        backup(path).map_err(|e| e.to_string())?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::write(path, new).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn status(p: &Paths) -> HookStatus {
    let read = |path: &Path| std::fs::read_to_string(path).ok();
    let claude = read(&p.claude_settings);
    let codex = read(&p.codex_config);
    HookStatus {
        claude_installed: p.claude_settings.parent().is_some_and(Path::exists),
        claude_connected: claude.as_deref().is_some_and(claude_is_connected),
        codex_installed: p.codex_config.parent().is_some_and(Path::exists),
        codex_connected: codex.as_deref().is_some_and(codex_is_connected),
    }
}

/// Installs the hook script and connects every agent that is installed.
pub fn connect(p: &Paths) -> Result<HookStatus, String> {
    if let Some(dir) = p.script.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p.script, HOOK_SCRIPT).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p.script, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let script = p.script.to_string_lossy().into_owned();
    let before = status(p);
    if before.claude_installed {
        rewrite(&p.claude_settings, |s| claude_connect(s, &script))?;
    }
    if before.codex_installed {
        rewrite(&p.codex_config, |s| codex_connect(s, &script))?;
    }
    Ok(status(p))
}

pub fn disconnect(p: &Paths) -> Result<HookStatus, String> {
    if p.claude_settings.exists() {
        rewrite(&p.claude_settings, claude_disconnect)?;
    }
    if p.codex_config.exists() {
        rewrite(&p.codex_config, codex_disconnect)?;
    }
    Ok(status(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIBE: &str = r#"{
  "model": "opus",
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "/Users/me/.vibecraft/hooks/vibecraft-hook.sh" }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "/Users/me/.vibecraft/hooks/vibecraft-hook.sh" }] }]
  }
}"#;

    #[test]
    fn claude_connect_keeps_existing_hooks_and_is_idempotent() {
        let once = claude_connect(VIBE, "/Users/me/.logitmate/bin/logitmate-hook").unwrap();
        let twice = claude_connect(&once, "/Users/me/.logitmate/bin/logitmate-hook").unwrap();
        assert_eq!(once, twice);
        let v: Value = serde_json::from_str(&once).unwrap();
        assert_eq!(v["model"], "opus");
        let stop = v["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert!(stop[0]["hooks"][0]["command"].as_str().unwrap().contains("vibecraft"));
        assert!(stop[1]["hooks"][0]["command"].as_str().unwrap().contains("logitmate-hook' claude-code"));
        assert_eq!(v["hooks"]["PreToolUse"][1]["matcher"], "*");
        assert_eq!(v["hooks"]["SessionStart"].as_array().unwrap().len(), 1);
        assert!(claude_is_connected(&once));
    }

    #[test]
    fn claude_disconnect_restores_the_original() {
        let connected = claude_connect(VIBE, "/x/logitmate-hook").unwrap();
        let back: Value = serde_json::from_str(&claude_disconnect(&connected).unwrap()).unwrap();
        assert_eq!(back, serde_json::from_str::<Value>(VIBE).unwrap());
    }

    #[test]
    fn claude_connect_creates_settings_from_nothing() {
        let v: Value = serde_json::from_str(&claude_connect("", "/x/logitmate-hook").unwrap()).unwrap();
        assert_eq!(v["hooks"].as_object().unwrap().len(), CLAUDE_EVENTS.len());
    }

    const CODEX: &str = "model = \"gpt-6-astra\"\nnotify = [\n    \"/Apps/SkyComputerUseClient\",\n    \"turn-ended\",\n]\nservice_tier = \"default\"\n\n[mcp_servers.figma]\nurl = \"https://mcp.figma.com/mcp\"\n";

    #[test]
    fn codex_chains_the_previous_notify_and_restores_it() {
        let connected = codex_connect(CODEX, "/x/logitmate-hook").unwrap();
        assert_eq!(codex_connect(&connected, "/x/logitmate-hook").unwrap(), connected);
        let doc: toml_edit::DocumentMut = connected.parse().unwrap();
        let notify: Vec<&str> = doc["notify"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        assert_eq!(notify, ["/x/logitmate-hook", "codex-chain", "/Apps/SkyComputerUseClient", "turn-ended"]);
        assert!(connected.contains("[mcp_servers.figma]") && connected.contains("service_tier = \"default\""));
        assert!(codex_is_connected(&connected));

        let restored: toml_edit::DocumentMut = codex_disconnect(&connected).unwrap().parse().unwrap();
        let notify: Vec<&str> = restored["notify"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
        assert_eq!(notify, ["/Apps/SkyComputerUseClient", "turn-ended"]);
        assert!(!codex_is_connected(&restored.to_string()));
    }

    #[test]
    fn codex_without_notify_gets_a_plain_hook_and_loses_it_again() {
        let connected = codex_connect("model = \"m\"\n", "/x/logitmate-hook").unwrap();
        assert!(connected.contains("\"codex\""));
        assert!(!codex_disconnect(&connected).unwrap().contains("notify"));
    }

    #[test]
    fn connect_and_disconnect_on_disk_with_backups() {
        let home = std::env::temp_dir().join(format!("logitmate-hooks-{}", std::process::id()));
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        std::fs::write(home.join(".claude/settings.json"), VIBE).unwrap();
        std::fs::write(home.join(".codex/config.toml"), CODEX).unwrap();
        let p = Paths::from_home(&home);

        let s = connect(&p).unwrap();
        assert!(s.claude_connected && s.codex_connected);
        assert!(p.script.exists());
        let backups = std::fs::read_dir(home.join(".claude")).unwrap().filter(|e| {
            e.as_ref().unwrap().file_name().to_string_lossy().contains("logitmate-backup")
        });
        assert_eq!(backups.count(), 1);

        let s = disconnect(&p).unwrap();
        assert!(!s.claude_connected && !s.codex_connected);
        std::fs::remove_dir_all(home).ok();
    }
}
