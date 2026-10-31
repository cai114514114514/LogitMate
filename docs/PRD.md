# LogitMate — Product Requirements

> In one line: **drop in any Live2D model and it comes alive** — it watches you, talks, remembers, has moods, and gets things done.

## 1. Why

Existing desktop companions each fall short (survey, October 2026):

| Product | Strengths | Gaps |
| --- | --- | --- |
| AIRI (open source, active) | Many model providers, screen awareness, community integrations | A VTuber platform first; the desktop experience is average |
| Open-LLM-VTuber | Voice chat with Live2D | v1 frozen, v2 rewrite in planning |
| Desktop Mate | Polished characters, DLC ecosystem | 3D only, weak AI and screen awareness, macOS still in beta |
| Lotaria / AIvy / CielChan | Screen awareness | Only their own characters |

**The opening:**
1. Truly universal Live2D import: understand what any model's expressions and motions *mean*, automatically.
2. A native-grade Mac experience: per-pixel click-through, sitting on windows, present on every Space.
3. A character with a life of its own, not just a chat box.
4. Privacy-first screen awareness, and real actions through MCP.

## 2. Core experience

1. **Alive** — breathing, blinking, idle motion; eyes and head follow the global cursor; dragging tilts the body with inertia while physics swings hair and skirt; head pats and body taps get different reactions; gets bored when ignored and sleepy late at night.
2. **Talks** — a speech bubble with streaming replies; emotion tags embedded in replies switch expressions (heart eyes, blush, cold sweat, dizzy eyes…) and motions in real time.
3. **Has a voice** — TTS with A/I/U/E/O vowel lip sync; push-to-talk ASR, wake word later.
4. **Remembers** — three tiers: short-term conversation, episode summaries, a user profile; a nightly "dream" pass consolidates memory.
5. **Knows what you're doing** — by default only the frontmost app name and window title; screenshots are opt-in. Comforts you when a build fails, stays quiet in meetings, bobs along to music.
6. **Gets things done** — an MCP host for calendar, files, shell, browser; every side-effecting action asks first.
7. **Universal models + community** — drop a model folder in to get a model profile; an LLM labels expressions and motions semantically, and you can edit the labels. A shared `.petprofile` holds persona, semantic mapping and the original download link — **never the model files**.

## 3. Original ideas

- **Window perching** — reads window frames so the character can sit on a window's top edge and sway when it moves.
- **Emotion engine** — a mood / energy / affection state machine drives idle behaviour and how often she speaks up, so she has personality even without the LLM.
- **Automatic expression semantics** — from cdi3 parameter names, exp3 file names and optional snapshots, an LLM infers "this expression = shy", so any model works with zero setup.
- **Privacy dashboard** — shows live what she has seen and remembered, with one-click forgetting.

## 4. Principles

- **Respect model authors** — read local files only; never copy, upload or bundle models. "About" reminds users to follow each model's terms and credit its creators.
- **Respect the Live2D license** — users download the Cubism SDK themselves after accepting Live2D's terms; it never enters git.
- **Privacy off by default** — anything beyond the frontmost app name is opt-in, always visible and revocable.
- **Don't intrude** — proactive speech is rate-limited and muted in full-screen apps and meetings.
- **Secrets stay out of the webview** — API keys live in the macOS Keychain and are only used by the Rust side.

## 5. Milestones

| Stage | Scope | Status |
| --- | --- | --- |
| M0 | Research, docs, Tauri project, Cubism SDK | ✅ |
| M1 | Transparent rendering, gaze, click-through, drag, tap reactions, tray, ModelAdapter v1 | ✅ |
| M2 | Speech bubble, streaming DeepSeek chat, emotion tags → expressions, memory v1, emotion engine v1 | ✅ |
| M2.5 | Agent Face (Claude Code, Codex, any hook-capable agent); zero-setup expression semantics | ✅ |
| M3 | TTS + vowel lip sync, push-to-talk; Focus Partner; desktop presence | |
| M4 | Drag-and-drop import of any model, LLM semantic labelling, model library, Cubism 2 | |
| M5 | Frontmost-app awareness, optional vision, window perching, MCP tools | |
| M6 | `.petprofile` sharing | |

## 6. Sample model: DeepSeek-chan

- Cubism 5 (moc3 version 5), 509 parameters, VBridger vowel shapes and ARKit-style face parameters.
- model3.json declares no expressions or motions: 23 exp3 files live in `Exp3/` and 8 motion3 files in `Animation/`, labelled by the hotkeys in `大肥鱼.vtube.json`.
- 49 clipping masks, so two mask textures (one holds at most 36).
- Five 4096×8192 textures, about 80 MB of VRAM after downscaling to display size.
- Terms: free model; no redistribution or bundling into paid products; credit required when used publicly — illustration and PSD by Kamiya Ryoko, Live2D rigging by 霓虹猫_NeonNeko.
