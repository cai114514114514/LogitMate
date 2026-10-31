# LogitMate

An AI desktop companion that brings any Live2D model to life (macOS · Tauri 2).

She stands on your desktop, follows your cursor with her eyes, sways when you drag her, reacts to head pats, and chats with you in a speech bubble — switching her own expressions as she talks and remembering what you tell her.

- **Lives in your desktop.** Drop her on a window and she stands on it, rides along when you move it, and tumbles down when you close it. Push her past the screen edge and she peeks in. She steps aside during calls and full-screen apps, and stays out of your screenshots.
- **Alive on any rig.** Her eyes dart and her head follows, her mouth moves as her words appear, she nods, tilts, hops and looks away, hums, stretches, yawns at night and dozes off when you're gone. Stroke her head with the cursor to pet her; shake it at her and she gets dizzy.
- **Any model, zero setup.** On first launch with a new model she looks at each of its expressions (rendered offscreen) and a vision model works out what they mean — heart eyes, blush, a loading spinner, a prop, an outfit — whatever the files are called.
- **A voice that fits her.** With a Xiaomi MiMo key she speaks her replies, in a voice a vision model designs from how she looks (you audition and keep one), with her mood in her tone and her mouth following the audio.
- **Looks at your screen when you ask.** "Can you check this?" — she takes one screenshot, reads it with a vision model and helps; nothing is kept.
- **Watches over you, if you want.** Opt in and she glances at your screen every few minutes, stays quiet, and speaks up only when it helps: a build that keeps failing, something you finished, working too late. Never during meetings or with a password manager open.
- **A focus partner.** Tell her what you're working on and she works next to you: the task and time stay above her head, she notices (from the app name only, kept on your Mac) when you drift and quietly waits for you, and celebrates when you finish.
- **The face of your coding agents.** Connected to Claude Code or Codex (opt-in, from the menu), she thinks along while they work, tells you when they need you, and cheers when long tasks finish.

- Product requirements: [docs/PRD.md](docs/PRD.md)
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Run

1. Download the Cubism SDK for Web 5 from <https://www.live2d.com/sdk/download/web/> (accepting Live2D's license) and unzip it as `app/vendor/cubism` (it is not in git).
2. Copy `.env.example` to `.env` and set `DEEPSEEK_API_KEY` (or save the key to the macOS Keychain).
3. In `app/`:

```bash
pnpm install
pnpm test
LOGITMATE_MODEL="/path/to/model.model3.json" pnpm tauri dev
```

Without `LOGITMATE_MODEL`, the first launch asks you to choose a model. The menu bar icon lets you talk to her, switch models, resize her, keep her on top, and wipe her memory.

Double-click her to chat. Tap her head for a pat, her body for a gesture, and drag her anywhere.

## License

LogitMate's source code is released under the [MIT License](LICENSE).

The MIT License covers the code in this repository only. It does not cover:

- **The Live2D Cubism SDK** — proprietary software from Live2D Inc., which you download yourself after accepting its license. Commercial releases must follow Live2D's SDK release license.
- **Live2D models** — copyright belongs to their creators. LogitMate only reads model files from your disk and never copies or uploads them; to learn a new model's expressions it sends small rendered stills of the character, once, to the LLM provider you chat with. Read each model's terms and credit its creators when you share your work.
