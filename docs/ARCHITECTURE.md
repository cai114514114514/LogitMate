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
├─ secrets.rs     API key: env → .env → Keychain   ├─ behavior/reactions.ts   expressions/gestures by label
│                                                  ├─ behavior/life.ts        gaze, talking mouth, idle life, cursor gestures
│                                                  ├─ behavior/gestures.ts    procedural gestures every model can do
│                                                  ├─ model/physicsRoutes.ts  write the physics input behind an output
├─ profiles.rs    learned model profiles (cache)   ├─ behavior/mood.ts        emotion engine v1
├─ agents.rs      Agent Face bridge (127.0.0.1)    ├─ behavior/companion.ts   chat turn ↔ body, greeting, fidgets
├─ agent_hooks.rs connect Claude Code / Codex      ├─ behavior/agentFace.ts   reactions to coding agents
├─ front_app.rs   frontmost app name (Focus)       ├─ behavior/focus.ts       Focus Partner session rules
├─ screen.rs      screenshot on request            ├─ brain/look.ts           "look at my screen" requests
└─ tts.rs         Xiaomi MiMo speech               ├─ voice/speaker.ts        sentence-by-sentence speech, audio-driven mouth
                                                   ├─ voice/sentences.ts      sentence cutting, emotion style tags
                                                   └─ voice/design.ts         a voice that fits the character
                                                   ├─ model/semantics.ts      expression meanings: prompt, parsing
                                                   ├─ renderer/stills.ts      stills: face box, change box, close-ups
                                                   ├─ brain/labeler.ts        stills → vision model → learned profile
                                                   ├─ brain/tags.ts           streaming [emo:]/[act:]/[remember:] parser
                                                   ├─ brain/expressions.ts    emotion/action vocabulary → this model
                                                   ├─ brain/prompt.ts         system prompt
                                                   ├─ brain/chat.ts           history, streaming, tag routing
                                                   ├─ ui/chatUi.ts            speech bubble and input
                                                   └─ ui/focusUi.ts           focus form and time pill
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
- Frame rate follows what is happening (see Performance).

## Performance
Measured on an M4 Max with DeepSeek-chan (509 parameters, 131 physics settings), per frame: Cubism Core deforming the model about 2.2 ms, physics 0.6–1.3 ms, drawing 0.8 ms, everything of ours (life layer, gaze, hit test) under 0.1 ms. So the main lever is how many frames are drawn:
- **Frame rate by state** (`main.ts`): 60 fps while someone drags her, moves the cursor on or right next to her window, or a gesture, petting or glance plays; 30 while the cursor moves somewhere around her (her eyes still follow it) or she talks or thinks; 24 idle; 20 after a minute without attention; 15 dozing; nothing while the window is hidden. The "around her" area is large (1.5× her height), so treating it as full engagement kept her at 60 fps whenever the user worked on that side of the screen. 24 and 15 divide 120 Hz evenly, so ProMotion displays get a steady cadence; the pacer keeps that cadence instead of drifting.
- **Physics at 30 steps/s** (rigs often ask for 60): Cubism interpolates between steps, so it looks the same and halves the physics cost.
- **No MSAA**: the canvas is already at device resolution.
- **Cursor polling** (`cursor.rs`): every 16 ms within 360 px of the window, every 100 ms farther away; the window frame is cached and refreshed on move/resize events; moves under half a pixel are not sent.
- **No per-frame garbage**: the life layer, pointer state, projection matrix and parameter routes are reused every frame, so the JS heap stays flat (about 300 MB WebContent RSS through four minutes at 60 fps).
- **Textures for the current size**: decoded at 1.5× the on-screen height (43 MB instead of 80 MB at Medium); picking a larger size reloads them.
- Dev builds log fps and the per-frame split every 10 s; `/part <hooks|update|render|after> off` switches parts of the frame off to bisect cost or memory.

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

## Life layer
Most models ship few motions (DeepSeek-chan has 8, mostly hand switches), so liveliness is procedural and works on any rig.
- **Physics routes** (`model/physicsRoutes.ts`): rigs made for VTube Studio compute ParamAngleX, ParamBodyAngleX, arms and hair in physics from input parameters (AngleX, PositionX, LeanInput…). Writing the output is overwritten in the same frame, so gaze, breathing and drag sway were invisible on such rigs. Each output driven by one dominant angle input is routed to that input (inverted when physics reflects it); gaze, breath, sway and the life layer all write through the routes, and arms and hair follow as under face tracking.
- **Gaze** (`Gaze`): the eyes jump in saccades and the head follows part of the way (eyes lead through an EyeBall offset against CubismLook's smoothed target). Modes: the cursor when it is near or on her; idle, alternating looks at the user with glances away; look-around bursts; a glance away when she starts talking, then mostly at the user; looking up while thinking (waiting for a reply, an agent at work); reading-like steps downward during a focus session with a glance at you every 20–40 s; head down while dozing.
- **Talking mouth** (`Talker`): text appearing in the bubble becomes syllables (one per CJK character, about one per three Latin letters) at 6.5 per second, speeding up so she never lags far behind a stream; each opens ParamMouthOpenY and one vowel shape, with a small head bob, pauses at punctuation and a nod at most sentence ends. No audio; TTS will drive the same parameters later.
- **Limbs**: gestures move logical limbs (ArmL/R, ForearmL/R, HandL/R, −1..1, + = away from the body) that PetModel maps onto each rig's parameters (Cubism sample names first, then VTube Studio-style names) and scales by their range. Arms on such rigs are physics outputs whose inputs move the whole body, so limb offsets are never routed: they are added after physics.
- **Gestures** (`gestures.ts`): keyframed curves over standard parameters and limbs — nod, shake, tilt, bounce, hop, lean, wiggle, sway, bow, look away, dizzy, sigh, yawn, stretch, jolt, and small forearm beats. The LLM can use nod, shake, tilt, bounce, lean, wiggle, look away and bow with `[act:…]` on every model; taps, talking and idle life use the rest.
- **Hands**: the model's own hand poses (raise a hand, point, hold a toy…) are held for a few seconds instead of snapping back, picked up in idle life, and used when she starts talking about a third of the time. While she talks, stressed syllables lift a forearm.
- **Idle life**: small never-repeating head and body drift scaled by energy (the official sample's breathing sway of 15° is cut to 3°, and side-to-side body drift is left out because on physics rigs it swings the legs); a slow weight shift from one side to the other every 8–22 s; every 14–40 s an idle act chosen by mood and energy (look around, tilt, wiggle, hum, stretch, yawn when tired, sigh when low); after 8 minutes with nobody around (3 when tired, never in a focus session) she dozes off, head drooping with an occasional jolt, and wakes when the cursor moves — startled if it is close.
- **Cursor gestures** (`PointerSense`): stroking back and forth over her head is a pat (eyes close, head leans into it, mood and affection go up); shaking the cursor at her makes her dizzy; the cursor on her brings a smile.

## Zero-setup expressions (M2.5)
Expression names range from 爱心眼 to `exp_03`, so names alone can't say what a model can show. On the first launch with a new model, LogitMate looks at every expression instead:
1. **Stills** (`Stage.still`, `PetModel.poseStill`): between two live frames the model is posed with all parameters at default plus one expression at full weight (no motion, physics, breath or gaze), drawn, and read back. The live frame drawn right after replaces it before anything reaches the screen; one still per frame.
2. **Crops** (`renderer/stills.ts`): a probe with eyes shut and mouth open locates the face on any standard rig; the pixel difference to the rest pose shows what an expression changed. Each image is rest | expression with the same crop, widened to whatever changed (shoes, skirt), plus a close-up when the change is small (tears, blush, sweat). Expressions that change nothing visible at rest are labelled from text only.
3. **Labelling** (`brain/labeler.ts`): batches of 6 go to the vision model (`deepseek-flash` on DeepSeek; the `llmVisionModel` setting overrides it) with each expression's name, file and moved parameters by display name. The reply gives kind (emotion, accessory, outfit, body, none), an emotion from the fixed vocabulary, intensity, valence, arousal and a few words on the look. Missing answers are retried; if the endpoint refuses images, names decide.
4. **Use**: `buildExpressionMap` prefers learned meanings over keyword guesses (props are never used as feelings), pats use pleasant expressions, and the system prompt tells her what each emotion looks like on this model ("love = heart-shaped pupils").
5. **Cache**: `profiles/<hash>.json` in the app data folder, keyed by model path, expressions and labelling version. *Relearn Expressions* redoes it. Only rendered stills of the character are sent, never model files, and only to the provider already used for chat.

Research behind it: Xpress (arXiv 2503.00283), an LLM choosing from a pre-rendered expression bank with descriptions and intensity; the GPT-4V emotion benchmark (arXiv 2312.04293), where large image batches drop items and subtle expressions are missed; Live Emoji (arXiv 1902.03529), valence and arousal attached to each expression.

## Focus Partner (M3)
Body doubling on the desktop: *Focus With Me…* asks for the task and a length (25/50/90 min), then she works next to you.
- **Visible task**: a pill above her head shows the time left and the task the whole session, and when you come back from a detour she names the task again.
- **What she knows**: `front_app` (Rust, NSWorkspace) returns only the frontmost app's name and bundle id, polled every 5 s during a session. `FocusSession` uses it locally; it is never sent to the LLM and she never says it.
- **Rules** (`behavior/focus.ts`, unit-tested with a fake clock): apps used in the first 3 minutes are the task's apps (common leisure apps never are); 3 minutes away gives one self-talk aside, at most every 10 minutes; staying 8 more minutes in that app adopts it as work; a murmur every 11–17 minutes while working; at the end she congratulates you (LLM, waits for any ongoing chat), adds to today's total, and offers another round after a 5-minute break.
- **While focused**: no idle fidgets, and the system prompt asks her to keep replies short and steer back to the task. Agent Face still reports.
- **Research**: an AI body double raised efficiency as much as a human one and was valued for not judging (Ara et al., arXiv 2509.12153); developers with ADHD asked for private, non-intrusive check-ins and no surveillance (Pimenova et al., arXiv 2609.21254); after a diversion people took 11–16 minutes to resume, sooner when the suspended task stayed visible (Iqbal & Horvitz, CHI 2007).
- Dev builds: `echo "/focus 0.5 write tests" > /tmp/logitmate-say.txt` starts a 30-second session.

## Look at my screen
She sees the screen only when asked: *Look at My Screen* in the menu, or a chat message such as "看看我的屏幕" / "can you check this?" (`brain/look.ts`).
- `screen_capture` (Rust) checks Screen Recording access (`CGPreflightScreenCaptureAccess`; without it, asks macOS and tells the user what to enable), captures the display she is on with `screencapture -R`, scales it to 1800 px with `sips`, deletes the temporary file at once and returns a JPEG. Nothing is kept.
- The message goes to the vision model with the image attached; memory stores only the text plus "[shared a screenshot]". She turns toward the middle of the screen while she looks.
- Legibility: DeepSeek's vision model read 12 px text in a 1600×1000 test image verbatim (about 1000 prompt tokens), so the full display at 1800 px works without tiling.

## Voice (M3)
Text to speech with Xiaomi MiMo V2.5 (`tts.rs`): OpenAI-style chat completions where the assistant message is the text and an `audio` field picks the voice; the reply carries base64 WAV. Built-in voices (冰糖, Mia…), VoiceDesign (a voice from a description) and VoiceClone (a voice from a sample). The key is `MIMO_API_KEY`/`mimo_api` (env, `.env`, then Keychain) and never reaches the webview.
- **Her own voice** (*Design Her Voice…*): the vision model looks at a still of the character (plus name and persona) and writes a voice description in MiMo's format (age and gender, texture, pace, default mood, one habit; no real actors) and a short self-introduction. VoiceDesign auditions it, up to four times; the kept sample is shrunk to 16 kHz mono, cut to 6–9 s at its quietest moment and saved as `profiles/voice-<model key>.wav`, and every later line clones it, so the voice fits the model and stays the same. Without one, a built-in voice is used.
- **Speaking** (`Speaker`): text appearing in the bubble is cut into sentences (`splitSentences`), each prefixed with a style tag for her current emotion (`(开心)`, `(cheerful)`; self-talk is whispered) and synthesized two ahead of playback; the first piece of a line is cut at its first comma, so speech starts as soon as possible. Measured on 2026-10-31: built-in voice about 1 s per sentence, cloned voice 2–5 s (server-dependent). A new line or a new message from the user cuts her off. *Speak Aloud* turns it off.
- **Mouth**: while audio plays, an AnalyserNode drives the mouth: loudness opens it and the spectral centroid picks the vowel shape (dark u/o to bright e/i); stress beats follow the openings. Without audio the text-paced `Talker` takes over.

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
pnpm test                     # adapter, tags, expressions, prompt, mood, gestures, semantics, stills, focus, life, physics routes
(cd src-tauri && cargo test)  # settings, folder listing, cursor math, SSE, .env, memory, profiles
LOGITMATE_MODEL=/path/to/x.model3.json pnpm tauri dev
echo "hello" > /tmp/logitmate-say.txt   # dev builds: send a chat message from a script
```
