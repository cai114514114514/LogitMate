# LogitMate — Where We Can Be Different

Research snapshot: 2026-10-31. After M2, LogitMate has what most companions already have: a Live2D body, LLM chat, emotion-driven expressions, memory. This document maps what is now table stakes, what nobody does well, and which bets fit us.

## 1. What is already table stakes

| Capability | Who has it |
| --- | --- |
| Anime avatar on the desktop | Desktop Mate (3D, ~2M users, macOS beta since 2026-06), VPet, Shimeji clones |
| LLM chat + TTS + memory | AIRI (open source, v0.12), CielChan, AikoMate, AI Desktop Pet |
| Screen awareness ("comments on what you do") | Lotaria, AI Desktop Pet (42kami), CielChan, Desktop Companion, AIRI |
| Basic computer use (open apps, write files) | Desktop Companion (DokProd), ChatGPT / Claude desktop apps |
| Agent-status pets | OpenAI Codex Pets (2026-05, OpenAI-only, `/hatch` turns an image into a pixel pet), AgentPets.dev |

Takeaway: "she sees your screen and chats" is no longer a differentiator. Indie titles all ship it, usually as periodic screenshots sent to a vision model.

## 2. Gaps nobody fills well

1. **Any Live2D model, zero setup.** Everyone ships their own characters or asks users to wire hotkeys by hand. Nobody automatically understands what an arbitrary model's expressions *mean*.
2. **A companion for people who work with AI agents.** Codex Pets only cover Codex and are pixel sprites; nothing gives Claude Code, Codex, Cursor and custom harnesses one shared, expressive face.
3. **Body doubling on the desktop.** AI body-doubling apps (Doppel, FOCO, Focali, dubbii) are mobile or web; we found no desktop-native one, even though focus work happens on the desktop.
4. **Real presence in the desktop.** Live2D companions stand in a fixed box. None perch on windows, react to window moves, or step aside when you share your screen.
5. **Bring your own character.** See-through (SIGGRAPH 2026, open source) splits one anime illustration into 23 layers, and Stretchy Studio auto-rigs those layers in the browser. Nobody has packaged "your drawing becomes your companion".
6. **A relationship over time.** Memory is everywhere, but nobody turns it into something you feel: a diary of your days together, anniversaries, a growing bond with visible consequences.

## 3. Candidate bets

Scores are 1-5. *Moat* means how hard it is to copy once shipped.

| # | Bet | User value | Uniqueness | Fit with Logit | Effort | Moat |
| --- | --- | --- | --- | --- | --- | --- |
| A | **Agent Face**: one expressive face for Claude Code / Codex / Logit-Harness sessions — thinks while they think, celebrates passing tests, asks you about permission prompts in her bubble | 4 | 5 | 5 | 2 (low) | 3 |
| B | **Focus Partner** (body doubling): you tell her the task; she works next to you, checks in at intervals, notices drift from the frontmost app *name* only, celebrates when you finish | 5 | 4 | 4 | 3 | 3 |
| C | **Zero-setup semantics**: render each expression and motion to a thumbnail, have a vision model label it, share the result as a `.petprofile` | 3 | 5 | 4 | 2 | 4 |
| D | **Desktop presence**: perch on window edges, sway when windows move, peek from screen edges, hide automatically in screen sharing and meetings | 4 | 4 | 3 | 3 | 3 |
| E | **Forge**: turn one illustration into a living companion (See-through layers → our own mesh rig, not Cubism) | 5 | 5 | 3 | 5 (high) | 5 |
| F | **Diary and bond**: a daily diary from your conversations and activity, anniversaries, affection that unlocks behaviours | 4 | 3 | 3 | 2 | 2 |
| G | **Hybrid brain**: Apple's on-device Foundation Models (macOS 27) for frequent small reactions, DeepSeek for real conversation — private and nearly free | 3 | 3 | 4 | 2 | 2 |
| H | **Visits**: your companion visits a friend's desktop and comes back with a story | 3 | 4 | 2 | 4 | 3 |

## 4. Recommendation

Position LogitMate as **the companion who works alongside you**, not a toy that watches you.

- **Next (M2.5, low effort, highest fit):** A + C. Agent Face makes LogitMate the visible face of the Logit toolchain (LogitOS, Logit-Harness) and of any coding agent, which no Live2D companion does. Zero-setup semantics turns "any Live2D model" from a claim into something you see on the first launch.
- **Then (M3 joins voice):** B + D. Focus Partner gives screen awareness a purpose and a privacy story ("she only knows the app name unless you ask"); presence makes her feel like she lives *in* the desktop.
- **Moonshot, in parallel research:** E. Highest wow and strongest moat, but the generated layers need our own deformation rig; start with a spike on See-through output quality.
- **Later:** F, G, H once the core loop is sticky.

## 5. Principles these bets must keep

- Privacy first: frontmost app name by default; screenshots only when the user asks, always visible.
- Never block work: proactive speech is rate-limited and silent in full-screen apps, meetings and screen sharing.
- Respect model creators: profiles are shared, model files never are.

## Sources

- AIRI releases: <https://github.com/moeru-ai/airi/releases>
- Desktop Mate macOS beta: <https://www.moguravr.com/desktop-mate-mac-beta-steam-sale-kizunaai/>
- Steam companions: [Desktop Companion](https://store.steampowered.com/app/4864680/Desktop_Companion/), [AI Desktop Pet](https://store.steampowered.com/app/4227700/AI_Desktop_Pet/), [CielChan](https://store.steampowered.com/app/4529510/CielChan_Anime_Desktop_AI_Companion/), [AikoMate](https://store.steampowered.com/app/4426320/AikoMate/)
- Codex Pets: <https://www.digitaltrends.com/computing/openais-codex-now-has-a-tiny-ai-pet-that-keeps-you-updated-while-you-code/>, AgentPets: <https://agentpets.dev/>
- See-through: <https://github.com/shitagaki-lab/see-through>, <https://arxiv.org/abs/2602.03749>; image-to-Live2D state: <https://github.com/waifuai/blog-posts/blob/main/docs/12-from-image-to-live2d-what-ai-can-and.md>; Stretchy Studio: <https://theneuralfeed.com/article/free-open-source-tool-to-instantly-rig-and-animate-your-illustrations-also-with-/keDvmX9L>
- Body doubling apps: [Doppel](https://apps.apple.com/app/id6755030867), [Focali](https://focali.leandro-sierra.com/en), [dubbii](https://apps.apple.com/gb/app/id6450302677)
- Desktop pet social features: [Datquinso Desktop Pets](https://rawg.io/games/1008614), [Weyrdlets](https://gamegeeker.com/games/weyrdlets-2-0-desktop-pets)
- Companion hardware trend (perception + proactivity): <https://www.sohu.com/a/1092806393_122645060>
- Apple Foundation Models at WWDC26: <https://www.macrumors.com/2026/06/09/apple-outlines-major-ai-and-developer-tool-updates/>, <https://callstack.com/blog/on-device-ai-after-wwdc-2026-whats-new>
