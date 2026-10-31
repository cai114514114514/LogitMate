# LogitMate Architecture

```
Tauri 2 (Rust, app/src-tauri)                     WebView (TypeScript, app/src)
├─ lib.rs         commands, plugins, startup       ├─ main.ts               startup, layout, tray menu
├─ cursor.rs      60 Hz global cursor → pet://cursor├─ model/adapter.ts      ModelAdapter: merge sources → model3 + profile
├─ tray.rs        menu bar icon and menu           ├─ model/loader.ts       read a model folder through Tauri
├─ model_files.rs list a model folder, scope assets├─ renderer/petModel.ts  CubismUserModel subclass
├─ settings.rs    settings.json                    ├─ renderer/stage.ts     WebGL2 canvas, frame loop, pixel hit test
├─ llm.rs         streaming OpenAI-compatible chat ├─ renderer/textures.ts  downscaled texture loading
├─ memory.rs      SQLite: messages + user facts    ├─ behavior/interaction.ts gaze, click-through, drag, tap
└─ secrets.rs     API key: env → .env → Keychain   ├─ behavior/reactions.ts   expressions/gestures by label
                                                   ├─ behavior/mood.ts        emotion engine v1
                                                   ├─ behavior/companion.ts   chat turn ↔ body, greeting, fidgets
                                                   ├─ brain/tags.ts           streaming [emo:]/[act:]/[remember:] parser
                                                   ├─ brain/expressions.ts    emotion/action vocabulary → this model
                                                   ├─ brain/prompt.ts         system prompt
                                                   ├─ brain/chat.ts           history, streaming, tag routing
                                                   └─ ui/chatUi.ts            speech bubble and input
```

## Loading a model
1. `get_settings` returns the model path (`LOGITMATE_MODEL` overrides it in development).
2. `list_model_files` lists the model folder and adds only that folder to the asset-protocol scope.
3. `normalizeModel` merges model3.json, `*.vtube.json` hotkeys, a folder scan and cdi3 parameter names into a **completed model3** (in memory only) and a **ModelProfile** (labels, idle group, capabilities).
4. `PetModel.load` feeds the completed model3 to the official `CubismModelSettingJson`, then loads moc, expressions, physics, pose, motions, renderer and textures.

## Rendering
- The window is a speech-bubble area (170 px) on top of the model; the model canvas keeps the model's aspect ratio.
- Texture scale = min(1, largest display height × 1.5 / model canvas height in pixels); textures are decoded with `createImageBitmap(..., { premultiplyAlpha: "premultiply", resize… })`.
- Mask textures = ceil(masked drawables / 36). One mask texture holds 36 masks; beyond that, masked parts are drawn unclipped (DeepSeek-chan has 49).
- The window is shown as soon as loading starts (transparent and click-through): WebKit suspends hidden webviews, which stalls loading.
- 60 fps while the cursor moves near her or she is being dragged, 30 fps otherwise.

## Click-through
- The window ignores the mouse by default. Rust pushes the global cursor every 16 ms in window logical pixels.
- After drawing, the frontend checks what is under the cursor: a UI element (`.ui`) or a model pixel with alpha > 16 turns click-through off. `readPixels` runs only when the cursor moved or every 6 frames.

## Chat (M2)
1. The user double-clicks her (or picks *Talk to Her…*) and types; `ChatSession` stores the message and builds `[system, …last 24 messages]`.
2. `systemPrompt` lists only the emotions and gestures this model can show, the user facts, the mood line, the time and the system locale.
3. `chat_stream` (Rust) streams from the OpenAI-compatible endpoint — DeepSeek `deepseek-flash` by default — and emits `chat://delta` events. SSE is split on bytes, so multi-byte characters across chunks stay intact. The API key never reaches the webview.
4. `TagParser` strips `[emo:X]`, `[act:Y]` and `[remember: …]` from the text as it streams, holding back a tag split across chunks. Emotions map to the model's expressions (`buildExpressionMap`), gestures play out and back, facts go to SQLite.
5. Replies are stored with their tags, so later turns keep the same style. *Forget Everything…* clears messages, facts and mood.

## Agent Face (M2.5)
- **Bridge**: `agents.rs` listens on `127.0.0.1:<random port>` and writes `{port, token}` to `~/Library/Application Support/com.logit.mate/agent-bridge.json` (mode 600). Requests need the token header; anything else gets 401/404.
- **Hook script**: `~/.logitmate/bin/logitmate-hook` POSTs the agent's hook JSON in the background with a 0.5 s timeout and always exits 0 at once, so it can never slow down or break an agent, and does nothing when LogitMate is not running.
- **Connecting** (*Coding Agents…* menu, with confirmation): Claude Code gets one more hook group per event next to existing ones; Codex `notify` (a single command) becomes `logitmate-hook codex-chain <previous command…>`, which forwards the event and then execs the previous command with its original arguments. Each file is backed up before the first change; *Disconnect* restores the previous entries.
- **Privacy**: `normalize` keeps only agent, session, project folder name, tool name, the agent's own notification text and TERM_PROGRAM. Prompts, tool input and output never leave the bridge.
- **Reactions** (`AgentFace`): working → the thinking face until 4 s of quiet; waiting for you → an aside in her voice whose bubble opens the agent's terminal (known terminals only, by bundle id); turns over 45 s → an upbeat "done" line; 3 failures in a row → encouragement (once per 10 min). Asides are not stored in the conversation and wait while you are talking to her.
- **Other agents** (e.g. Logit-Harness): pipe Claude-Code-shaped hook JSON (`hook_event_name`, `session_id`, `cwd`, `tool_name`, `message`) into `logitmate-hook <agent-name>`.

## Emotion engine v1
`Mood` keeps mood (−1..1, half-life 10 min toward 0.2), energy (from the local hour) and affection (pats +1, chats +0.5), persisted in localStorage. It feeds the prompt, greetings (first meeting, or back after 6 h) and idle fidgets (after 4 quiet minutes, more often when energetic).

## License boundaries
- `app/vendor/cubism/`: the Cubism SDK you download (Live2D proprietary license), git-ignored.
- `app/.cubism/framework/`: generated by `pnpm sync:cubism` — Framework sources with `// @ts-nocheck`, so our strict tsconfig is not dragged down by the SDK's non-strict code.
- `app/public/cubism/`: copies of Core and shaders served by Vite.
- Models are referenced by path only; the adapter test reads a local copy via `LOGITMATE_MODEL_DIR`.
- `.env` holds secrets and is git-ignored; `.env.example` shows the expected name.

## Development
```bash
cd app
pnpm install
pnpm sync:cubism              # after placing the SDK in app/vendor/cubism
pnpm test                     # adapter, tags, expressions, prompt, mood, gestures
(cd src-tauri && cargo test)  # settings, folder listing, cursor math, SSE, .env, memory
LOGITMATE_MODEL=/path/to/x.model3.json pnpm tauri dev
echo "hello" > /tmp/logitmate-say.txt   # dev builds: send a chat message from a script
```
