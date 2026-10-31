import "./log";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { AgentFace, type AgentEvent } from "./behavior/agentFace";
import { Companion } from "./behavior/companion";
import { addFocusToday, FocusSession, focusLines, type FrontApp } from "./behavior/focus";
import { GESTURES, SPOKEN_GESTURES, type GestureName } from "./behavior/gestures";
import { Interaction, type WindowBox } from "./behavior/interaction";
import { Life } from "./behavior/life";
import { Mood } from "./behavior/mood";
import { findPerch, isFullScreen, perchFeet, settleAtEdge, type Perch, type Rect, type WindowInfo } from "./behavior/presence";
import { Reactions } from "./behavior/reactions";
import { ChatSession } from "./brain/chat";
import { buildExpressionMap, type ExpressionMap } from "./brain/expressions";
import { learnExpressions, loadLearned, stillJpeg } from "./brain/labeler";
import { isLookRequest } from "./brain/look";
import { AWAY_MS, glanceGap, initialWatch, isPrivateApp, mayRemark, noteRemark, parseWatch, watchMessages } from "./brain/watch";
import { systemPrompt } from "./brain/prompt";
import { readModelSource } from "./model/loader";
import { profileKey, type LearnedProfile } from "./model/semantics";
import { PetModel } from "./renderer/petModel";
import { Stage, startCubism } from "./renderer/stage";
import { alphaBox } from "./renderer/stills";
import { ChatUI } from "./ui/chatUi";
import { writeBrief } from "./voice/design";
import { Speaker } from "./voice/speaker";
import { FocusUI } from "./ui/focusUi";

interface Settings {
  modelPath?: string | null;
  height?: number | null;
  x?: number | null;
  y?: number | null;
  characterName?: string | null;
  persona?: string | null;
  speak?: boolean | null;
  watch?: boolean | null;
  stepAside?: boolean | null;
}

/** Model heights for the Size menu, in logical pixels. */
const SIZES: Record<string, number> = { "size-s": 420, "size-m": 600, "size-l": 820 };
/** Room above the head for the speech bubble and input. */
const TALK_HEIGHT = 170;
/** Narrow models still get a usable bubble. */
const MIN_WIDTH = 300;
const MARGIN = 24;
interface HookStatus {
  claudeInstalled: boolean;
  claudeConnected: boolean;
  codexInstalled: boolean;
  codexConnected: boolean;
}

/**
 * Frame rates: someone interacting or a gesture playing; talking or thinking; idle; idle with
 * nobody paying attention for a while; dozing.
 */
const FPS = { active: 60, lively: 30, idle: 24, calm: 20, asleep: 15 };
const CALM_AFTER_MS = 60_000;
/** Greet again after being away this long. */
const GREET_AFTER_HOURS = 6;
const FOCUS_BREAK_MS = 5 * 60_000;
/** How often Focus Partner looks at which app is in front. */
const FRONT_APP_POLL_S = 5;

const win = getCurrentWindow();
const toastEl = document.getElementById("toast")!;

function toast(text: string, ms = 4000): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  if (ms > 0) setTimeout(() => (toastEl.hidden = true), ms);
}

async function pickModel(): Promise<string | null> {
  const path = await open({
    title: "Choose a Live2D model (*.model3.json)",
    multiple: false,
    directory: false,
    filters: [{ name: "Live2D model", extensions: ["json"] }],
  });
  if (!path) return null;
  if (!path.toLowerCase().endsWith(".model3.json")) {
    await message("Please choose a file ending in .model3.json.", { title: "LogitMate", kind: "warning" });
    return null;
  }
  return path;
}

/** Keeps the window on the screen's usable area; with no position yet, the bottom-right corner. */
async function placeOnScreen(box: WindowBox, wanted: { x?: number | null; y?: number | null }): Promise<void> {
  const mon = await currentMonitor();
  if (!mon) return;
  const area = mon.workArea ?? { position: mon.position, size: mon.size };
  const s = mon.scaleFactor;
  const left = area.position.x / s;
  const top = area.position.y / s;
  const right = left + area.size.width / s;
  const bottom = top + area.size.height / s;
  const x = wanted.x ?? right - box.width - MARGIN;
  const y = wanted.y ?? bottom - box.height;
  box.x = Math.min(Math.max(x, left), right - box.width);
  box.y = Math.min(Math.max(y, top), bottom - box.height);
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const step = (what: string) => console.info(`[pet] ${what} +${Math.round(performance.now() - t0)}ms`);
  // Show the (still empty, transparent, click-through) window right away: WebKit throttles
  // hidden webviews, which stalls loading.
  await invoke("set_ignore_cursor", { ignore: true });
  await win.show();
  const settings = await invoke<Settings>("get_settings");
  const save = (patch: Partial<Settings>) => {
    Object.assign(settings, patch);
    invoke("save_settings", { settings }).catch((e) => console.error("save_settings", e));
  };

  let modelPath = settings.modelPath ?? null;
  if (!modelPath) {
    await invoke("set_ignore_cursor", { ignore: false });
    toast("Choose a Live2D model to begin", 0);
    modelPath = await pickModel();
    if (!modelPath) return toast("No model chosen. Pick one from the menu bar icon.", 0);
    save({ modelPath });
  }

  startCubism();
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const stage = new Stage(canvas);
  const source = await readModelSource(modelPath);
  const dpr = window.devicePixelRatio || 1;
  // Textures are decoded for the size she is shown at; choosing a larger size reloads them.
  const texturesFor = settings.height ?? SIZES["size-m"];
  const model = await PetModel.load(stage.gl, source.normalized, {
    url: source.url,
    canvasWidth: stage.canvas.width,
    canvasHeight: stage.canvas.height,
    maxDisplayHeightPx: texturesFor * dpr,
    onProgress: step,
  });
  stage.model = model;
  step("model loaded");

  // Window = speech-bubble area on top of the model.
  const box: WindowBox = { x: 0, y: 0, width: 0, height: 0 };
  const talk = document.getElementById("talk")!;
  const layout = (modelHeight: number) => {
    const modelWidth = Math.round(modelHeight * model.aspect());
    box.width = Math.max(modelWidth, MIN_WIDTH);
    box.height = modelHeight + TALK_HEIGHT;
    Object.assign(canvas.style, {
      width: `${modelWidth}px`,
      height: `${modelHeight}px`,
      left: `${(box.width - modelWidth) / 2}px`,
      top: `${TALK_HEIGHT}px`,
    });
    talk.style.height = `${TALK_HEIGHT}px`;
  };
  layout(settings.height ?? SIZES["size-m"]);
  await placeOnScreen(box, settings);
  await win.setSize(new LogicalSize(box.width, box.height));
  await win.setPosition(new LogicalPosition(box.x, box.y));

  const profile = model.normalized.profile;
  // Label guesses now; what each expression really means once learned (cached per model).
  const map = buildExpressionMap(profile);
  const mood = new Mood();
  const reactions = new Reactions(model);
  const learnedKey = profileKey(modelPath, profile.expressions);
  let learned: LearnedProfile | null = null;
  const useLearned = (l: LearnedProfile) => {
    learned = l;
    Object.assign(map, buildExpressionMap(profile, l));
    reactions.setPatPool(map.pats);
  };
  const cached = await loadLearned(learnedKey);
  if (cached) useLearned(cached);
  const ui = new ChatUI();
  const zh = navigator.language.toLowerCase().startsWith("zh");
  let focus: FocusSession | null = null;
  const chat = new ChatSession(async () =>
    systemPrompt({
      name: settings.characterName || profile.name,
      persona: settings.persona,
      facts: await invoke<string[]>("memory_facts", { limit: 40 }),
      moodLine: mood.describe(),
      emotions: [...map.emotions.keys()],
      looks: Object.fromEntries(map.looks),
      focus: focus && { task: focus.task, minutesLeft: Math.ceil(focus.remainingMs(Date.now()) / 60_000) },
      actions: [...new Set([...map.actions.keys(), ...SPOKEN_GESTURES])],
      now: new Date(),
      locale: navigator.language,
    }),
  );
  // Procedural life: gaze, talking mouth, idle acts, gestures every model can do.
  const life = new Life();
  const syncLife = () => {
    life.energy = mood.energy();
    life.mood = mood.state.mood;
  };
  syncLife();
  // Her voice (MiMo TTS), when a key is set; see voice/.
  const speaker = new Speaker(learnedKey, zh);
  const ttsStatus = () => invoke<{ available: boolean; hasVoice: boolean }>("tts_status", { key: learnedKey });
  speaker.enabled = (await ttsStatus()).available && settings.speak !== false;
  speaker.onError = (e) => console.warn("[pet] tts", e);
  let auditioning = false;
  const companion = new Companion({
    chat,
    ui,
    reactions,
    mood,
    map,
    voiceEmotion: (emotion) => (speaker.emotion = emotion),
    procedural: (action) => {
      if (!(action in GESTURES)) return false;
      life.play(action as GestureName);
      return true;
    },
  });
  ui.onSpeak = (text, quiet, fresh) => {
    if (speaker.enabled && !auditioning) speaker.feed(text, quiet, fresh);
    life.speak(text, quiet, speaker.enabled || auditioning);
  };
  ui.onSpeakEnd = () => speaker.flush();

  // Agent Face: coding agents report through the Rust bridge; she reacts without intruding.
  let agentThinking = false;
  const agentFace = new AgentFace((r) => {
    if (r.type === "thinking") {
      agentThinking = r.on;
      const thinking = map.emotions.get("thinking");
      if (!thinking || chat.busy) return;
      if (r.on) reactions.express(thinking, 0);
      else reactions.relax();
    } else if (r.type === "emotion") {
      const name = map.emotions.get(r.emotion);
      if (name && !chat.busy) reactions.express(name, r.ms);
    } else {
      const terminal = r.terminal;
      const jump = terminal ? () => void invoke("focus_terminal", { terminal }).catch((e) => console.warn(e)) : undefined;
      void companion.remark(r.note, r.fallback, jump);
    }
  }, zh);
  await listen<AgentEvent>("agent://event", ({ payload }) => agentFace.handle(payload));
  setInterval(() => agentFace.tick(), 1000);

  let learning = false;
  const learn = async () => {
    if (learning) return;
    learning = true;
    try {
      const l = await learnExpressions({ stage, model, key: learnedKey, onProgress: (text) => toast(text, 0) });
      useLearned(l);
      const shown = [...map.emotions.keys()].length;
      toast(`Learned ${l.expressions.length} expressions; she can show ${shown} feelings.`);
      console.info(`[pet] learned by ${l.labeller}: ${l.expressions.map((m) => `${m.name}=${m.emotion ?? m.kind}`).join(", ")}`);
    } catch (e) {
      toast(String(e).includes("NO_API_KEY") ? "Add a DeepSeek API key so she can learn her expressions." : `Couldn't learn expressions: ${String(e).slice(0, 100)}`);
      console.warn("[pet] learning expressions failed", e);
    } finally {
      learning = false;
    }
  };

  // Designing her voice: the vision model describes a voice that fits her, MiMo auditions it, the
  // user keeps one, and later lines clone it (voice/design.ts).
  const designVoice = async () => {
    if (!(await ttsStatus()).available) {
      await message(
        zh
          ? "她说话需要小米 MiMo 的 API key：在 platform.xiaomimimo.com 创建一个，然后在项目的 .env 里加一行 mimo_api=你的key，重启 LogitMate。"
          : "Her voice needs a Xiaomi MiMo API key: create one at platform.xiaomimimo.com, add mimo_api=YOUR_KEY to .env, and restart LogitMate.",
        { title: zh ? "她的声音" : "Her Voice" },
      );
      return;
    }
    auditioning = true;
    try {
      ui.say(zh ? "（让我想想，我的声音应该是什么样的…）" : "(Let me think about what I should sound like…)", true);
      const still = await stage.still(() => model.poseStill(null));
      const brief = await writeBrief(settings.characterName || profile.name, settings.persona, zh, stillJpeg(still));
      console.info(`[pet] voice brief: ${brief.description}`);
      for (let i = 1; i <= 4; i++) {
        ui.say(zh ? `（试音 ${i}…）` : `(Audition ${i}…)`, true);
        const wav = await invoke<string>("tts_design", { description: brief.description, text: brief.line });
        ui.say(brief.line, true);
        await speaker.playWav(wav);
        ui.done();
        const keep = await ask(`${zh ? "要用这个声音吗？" : "Keep this voice?"}\n\n${brief.description}`, {
          title: zh ? "她的声音" : "Her Voice",
          okLabel: zh ? "就用这个" : "Keep",
          cancelLabel: i < 4 ? (zh ? "再换一个" : "Try Another") : zh ? "都不要" : "None of These",
        });
        if (keep) {
          await invoke("tts_save_voice", { key: learnedKey, wav });
          speaker.enabled = settings.speak !== false;
          toast(zh ? "记住我的声音啦～" : "Voice saved~");
          return;
        }
      }
      toast(zh ? "没有保存，随时可以再试。" : "Nothing saved; try again anytime.");
    } catch (e) {
      ui.say(`${zh ? "声音没设计好…" : "Couldn't design a voice…"} ${String(e).slice(0, 100)}`);
    } finally {
      auditioning = false;
    }
  };

  // Focus Partner: she works next to you; see behavior/focus.ts.
  const focusUi = new FocusUI(zh);
  const lines = focusLines(zh);
  let lastFocus = { task: "", minutes: 25 };
  let breakTimer = 0;
  const flash = (emotion: string, ms: number) => {
    const name = map.emotions.get(emotion);
    if (name) reactions.express(name, ms);
  };
  const startFocus = (task: string, minutes: number) => {
    clearTimeout(breakTimer);
    focus = new FocusSession(task, minutes, Date.now());
    lastFocus = { task, minutes };
    companion.focused = true;
    focusUi.show(task, focus.remainingMs(Date.now()));
    ui.say(lines.started(task, minutes));
    flash("happy", 2500);
  };
  const endFocus = (completed: boolean) => {
    if (!focus) return;
    const { task } = focus;
    const minutes = focus.focusedMinutes(Date.now());
    focus = null;
    companion.focused = false;
    focusUi.hide();
    if (!completed) {
      ui.say(lines.stopped(minutes));
      return;
    }
    const today = addFocusToday(minutes);
    mood.onEmotion("happy");
    // Asides give way to a conversation; this one waits for it to end instead of being dropped.
    const celebrate = () => {
      if (chat.busy) return void setTimeout(celebrate, 2000);
      void companion.remark(
        `(System note, not from the user: the user just finished a ${minutes}-minute focus session on "${task}"; ` +
          `${today} focused minutes today. Congratulate them in one short sentence and suggest a 5-minute break.)`,
        lines.done(task, minutes),
      );
    };
    celebrate();
    breakTimer = window.setTimeout(() => {
      if (!focus) ui.say(lines.breakOver(task), false, () => startFocus(task, lastFocus.minutes));
    }, FOCUS_BREAK_MS);
  };
  focusUi.onWantFocus = () => win.setFocus();
  focusUi.onStart = startFocus;
  focusUi.onStop = () => endFocus(false);
  let focusTicks = 0;
  setInterval(async () => {
    if (!focus) return;
    const now = Date.now();
    focusUi.update(focus.remainingMs(now));
    const look = focusTicks++ % FRONT_APP_POLL_S === 0;
    const app = look ? await invoke<FrontApp | null>("front_app").catch(() => null) : null;
    const signal = focus?.observe(app, Date.now());
    if (!signal) return;
    if (import.meta.env.DEV) console.info(`[pet] focus: ${signal.type}`);
    if (signal.type === "done") return endFocus(true);
    if (chat.busy || ui.inputOpen) return;
    if (signal.type === "drift") {
      ui.murmur(lines.drift());
      flash("thinking", 4000);
    } else if (signal.type === "back") {
      ui.say(lines.back(focus!.task));
      flash("happy", 2500);
    } else {
      ui.murmur(lines.murmur());
    }
  }, 1000);

  ui.onWantFocus = () => win.setFocus();
  // "Look at my screen" (brain/look.ts): only when asked.
  const screenRect = async () => {
    const mon = await currentMonitor();
    if (!mon) return null;
    const s = mon.scaleFactor;
    return { x: mon.position.x / s, y: mon.position.y / s, width: mon.size.width / s, height: mon.size.height / s };
  };
  const lookAtScreen = async (question: string) => {
    life.noteInteraction();
    const screen = await screenRect();
    if (!screen) return void companion.talk(question);
    // She turns toward the middle of the screen while she looks.
    const face = { x: box.x + box.width / 2, y: box.y + TALK_HEIGHT + 80 };
    life.glance(
      Math.tanh((screen.x + screen.width / 2 - face.x) / 400),
      Math.tanh((face.y - (screen.y + screen.height / 2)) / 400),
      3,
    );
    ui.say(zh ? "（我看一眼…）" : "(Let me take a look…)", true);
    try {
      const jpeg = await invoke<string>("screen_capture", screen);
      await companion.talk(question, `data:image/jpeg;base64,${jpeg}`);
    } catch (e) {
      ui.say(
        String(e).includes("NO_SCREEN_ACCESS")
          ? zh
            ? "我还没有看屏幕的权限～请在 系统设置 → 隐私与安全性 → 屏幕录制 里打开 LogitMate，然后重启我。"
            : "I can't see your screen yet~ Turn on LogitMate in System Settings → Privacy & Security → Screen Recording, then restart me."
          : `${zh ? "没看清…" : "I couldn't see it…"} ${String(e).slice(0, 80)}`,
      );
    }
  };
  // Watch Over Me (brain/watch.ts): opt-in glances at the screen, rarely a remark.
  let watchState = initialWatch(Date.now());
  let glancing = false;
  const peek = document.getElementById("peek")!;
  const watchDecide = async (image: string, app: string | null) => {
    const reply = await invoke<string>("llm_complete", {
      messages: watchMessages(
        {
          name: settings.characterName || profile.name,
          persona: settings.persona,
          zh,
          now: new Date(),
          app,
          focusTask: focus?.task,
          recent: watchState.recent,
          emotions: [...map.emotions.keys()],
        },
        image,
      ),
      json: true,
      vision: true,
    });
    const d = parseWatch(reply);
    if (import.meta.env.DEV) console.info(`[pet] watch: ${d?.say ? `${d.urgent ? "(urgent) " : ""}${d.line}` : "quiet"}`);
    if (!d || !mayRemark(watchState, d, Date.now()) || chat.busy) return;
    noteRemark(watchState, d.line, Date.now());
    companion.say(d.line, d.emotion);
  };
  const watchTick = async () => {
    const now = Date.now();
    if (settings.watch !== true || glancing || now < watchState.nextGlance) return;
    watchState.nextGlance = now + glanceGap();
    // Not while they talk to her, she speaks, sleeps, or nobody is at the computer.
    if (chat.busy || ui.inputOpen || speaker.busy || auditioning || life.asleep || life.inputIdleMs > AWAY_MS) return;
    const app = await invoke<FrontApp | null>("front_app").catch(() => null);
    if (isPrivateApp(app)) return;
    const screen = await screenRect();
    if (!screen) return;
    glancing = true;
    peek.hidden = false;
    const face = { x: box.x + box.width / 2, y: box.y + TALK_HEIGHT + 80 };
    life.glance(
      Math.tanh((screen.x + screen.width / 2 - face.x) / 400),
      Math.tanh((face.y - (screen.y + screen.height / 2)) / 400),
      2,
    );
    try {
      const jpeg = await invoke<string>("screen_capture", screen);
      peek.hidden = true;
      await watchDecide(`data:image/jpeg;base64,${jpeg}`, app?.name ?? null);
    } catch (e) {
      if (String(e).includes("NO_SCREEN_ACCESS")) {
        save({ watch: false });
        void invoke("set_watch_menu", { checked: false });
        ui.say(zh ? "我还没有看屏幕的权限，先把陪伴观察关掉啦。" : "I can't see your screen yet, so I turned Watch Over Me off.");
      } else console.warn("[pet] watch", e);
    } finally {
      peek.hidden = true;
      glancing = false;
    }
  };
  setInterval(() => void watchTick(), 15_000);
  // Typing counts as being there (for dozing and for glances).
  setInterval(async () => {
    life.inputIdleMs =
      (await invoke<number>("user_idle").catch((e) => {
        if (import.meta.env.DEV && !idleLogged) console.warn("[pet] user_idle", e);
        return Infinity;
      })) * 1000;
    if (import.meta.env.DEV && !idleLogged) {
      idleLogged = true;
      console.info(`[pet] input idle ${Math.round(life.inputIdleMs)} ms`);
    }
  }, 5000);
  let idleLogged = false;

  ui.onSubmit = (text) => {
    life.noteInteraction();
    speaker.stop();
    if (isLookRequest(text)) void lookAtScreen(text);
    else void companion.talk(text);
  };
  canvas.addEventListener("dblclick", () => {
    life.noteInteraction();
    void ui.openInput();
  });
  const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
  life.handPoses = map.actions.size;
  life.onEvent = (e) => {
    if (e.type === "petted") {
      mood.onPat();
      flash(mood.state.affection > 20 ? "love" : "happy", 2500);
    } else if (e.type === "dizzy") {
      flash("confused", 2500);
    } else if (e.type === "woke") {
      flash("surprised", 1200);
    } else if (e.type === "hands") {
      reactions.gesture(undefined, e.ms);
    }
  };

  // Desktop presence (behavior/presence.ts): standing on windows, peeking from edges, stepping aside.
  let perch: Perch | null = null;
  // Where her feet are inside her window: offset from the left, gap above the bottom, and how
  // tall she stands above them (points).
  const feetIn = { x: box.width / 2, gap: 0, body: box.height - TALK_HEIGHT };
  const measureFeet = async () => {
    const still = await stage.still(() => model.poseStill(null));
    const body = alphaBox(still);
    if (!body) return;
    const scale = canvas.width / canvas.clientWidth;
    feetIn.x = canvas.offsetLeft + (body.x0 + body.x1) / 2 / scale;
    feetIn.gap = box.height - (canvas.offsetTop + body.y1 / scale);
    feetIn.body = (body.y1 - body.y0) / scale;
    if (import.meta.env.DEV) {
      console.info(
        `[pet] feet: still ${still.width}×${still.height}, body ${JSON.stringify(body)}, canvas top ${canvas.offsetTop} ` +
          `${canvas.clientWidth}×${canvas.clientHeight}, box ${box.width}×${box.height} → ${JSON.stringify(feetIn)}`,
      );
    }
  };
  const feet = () => ({ x: box.x + feetIn.x, y: box.y + box.height - feetIn.gap });
  let area: Rect | null = null;
  const moveBox = (x: number, y: number) => {
    box.x = x;
    box.y = y;
    void win.setPosition(new LogicalPosition(x, y));
    // Standing on a window, the room above her head can be above the screen: keep the bubble on it.
    const hidden = area ? area.y - y : 0;
    talk.style.transform = hidden > 0 ? `translateY(${Math.min(hidden, box.height - TALK_HEIGHT - 40)}px)` : "";
  };
  // Standing on a window, her soles sink this far into its title bar so she looks planted.
  const SINK = 10;
  const moveFeet = (fx: number, fy: number) => moveBox(fx - feetIn.x, fy + SINK - (box.height - feetIn.gap));
  const workArea = async (): Promise<Rect | null> => {
    const mon = await currentMonitor();
    if (!mon) return null;
    const a = mon.workArea ?? { position: mon.position, size: mon.size };
    const s = mon.scaleFactor;
    area = { x: a.position.x / s, y: a.position.y / s, width: a.size.width / s, height: a.size.height / s };
    return area;
  };
  /** After a drag: land on a window under her feet, or settle on screen (peeking past an edge). */
  const settle = async () => {
    const windows = await invoke<WindowInfo[]>("list_windows").catch(() => []);
    const f = feet();
    const screen = await workArea();
    const target = findPerch(f, windows, (screen?.y ?? 0) + feetIn.body);
    if (target) {
      perch = { id: target.id, dx: f.x - target.x };
      life.peek(0);
      moveFeet(f.x, target.y);
    } else if (screen) {
      const s = settleAtEdge(box, screen);
      life.peek(s.side);
      moveBox(s.x, s.y);
    }
    save({ x: box.x, y: box.y });
  };
  /** The window under her went away: she drops to the bottom of the screen and lands with a hop. */
  const fall = async () => {
    perch = null;
    const screen = await workArea();
    if (!screen) return;
    const floor = screen.y + screen.height - box.height;
    let v = 0;
    let last = performance.now();
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        v += 2800 * dt;
        const y = Math.min(floor, box.y + v * dt);
        moveBox(box.x, y);
        if (y >= floor || perch) return done();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    life.play("hop");
    flash("surprised", 1200);
    save({ x: box.x, y: box.y });
    if (import.meta.env.DEV) console.info(`[pet] fell to y ${Math.round(box.y)}`);
  };
  // Riding along with the window she stands on.
  let following = false;
  let missed = 0;
  let lastFollow = { x: 0, t: 0 };
  setInterval(async () => {
    if (!perch || following || interaction.dragging) return;
    following = true;
    try {
      const windows = await invoke<WindowInfo[]>("list_windows");
      if (!perch) return;
      const f = perchFeet(perch, windows);
      if (!f) {
        // Gone for two looks in a row (not just a hiccup while it redraws): fall.
        if (++missed >= 2) void fall();
        return;
      }
      missed = 0;
      const now = performance.now();
      const cur = feet();
      if (Math.abs(f.x - cur.x) > 0.5 || Math.abs(f.y + SINK - cur.y) > 0.5) {
        interaction.carry(((f.x - lastFollow.x) / Math.max(1, now - lastFollow.t)) * 1000);
        moveFeet(f.x, f.y);
      }
      lastFollow = { x: f.x, t: now };
    } finally {
      following = false;
    }
  }, 50);
  // Stepping aside during calls (microphone in use) and full-screen apps.
  let aside = false;
  let asideVotes = 0;
  setInterval(async () => {
    if (settings.stepAside === false) {
      asideVotes = 0;
      if (aside) setAside(false);
      return;
    }
    const [mic, windows, monitors] = await Promise.all([
      invoke<boolean>("mic_in_use").catch(() => false),
      invoke<WindowInfo[]>("list_windows").catch(() => []),
      availableMonitors().catch(() => []),
    ]);
    const screens = monitors.map((m) => ({
      x: m.position.x / m.scaleFactor,
      y: m.position.y / m.scaleFactor,
      width: m.size.width / m.scaleFactor,
      height: m.size.height / m.scaleFactor,
    }));
    const want = mic || isFullScreen(windows[0], screens);
    // Two looks in a row before changing, so a brief mic blip or a resize doesn't flicker her.
    asideVotes = want === aside ? 0 : asideVotes + 1;
    if (asideVotes >= 2) {
      asideVotes = 0;
      setAside(want);
    }
  }, 2000);
  const setAside = (on: boolean) => {
    aside = on;
    if (import.meta.env.DEV) console.info(`[pet] step aside: ${on}`);
    document.body.classList.toggle("aside", on);
    if (on) setTimeout(() => aside && void win.hide(), 400);
    else void win.show();
  };

  const interaction = new Interaction(stage, box, {
    onTap: (fy) => {
      life.noteInteraction();
      if (fy < 0.32) {
        mood.onPat();
        reactions.pat();
        life.play(pick<GestureName>(["wiggle", "tilt", "nod"]));
      } else if (map.actions.size && Math.random() < 0.5) {
        mood.touch();
        reactions.gesture();
      } else {
        mood.touch();
        life.play(pick<GestureName>(["hop", "bounce"]));
        flash("surprised", 1500);
      }
    },
    onDragStart: () => {
      perch = null;
    },
    moveTo: (x, y) => {
      box.x = x;
      box.y = y;
      win.setPosition(new LogicalPosition(x, y));
    },
    onDragEnd: () => void settle(),
  });
  await interaction.attach();
  let lastAttention = performance.now();
  stage.hooks = {
    beforeUpdate: (dt) => {
      interaction.beforeUpdate(dt);
      life.working = !!focus;
      life.thinking = (chat.busy && !life.talking) || agentThinking;
      const f = life.update(dt, interaction.pointer);
      model.lookAt(f.look.x, f.look.y);
      model.procedural = { offsets: f.offsets, eyeOpen: f.eyeOpen, gaze: f.gaze };
      life.voice = speaker.mouth();
      life.voiceBusy = speaker.busy;
      // Most of a frame is Cubism Core deforming the model; drawing fewer frames is the big saving.
      const now = performance.now();
      const engaged = interaction.engagement;
      if (engaged !== "none" || life.talking || life.thinking || ui.inputOpen) lastAttention = now;
      stage.maxFps =
        engaged === "close" || life.animating
          ? FPS.active
          : engaged === "near" || life.talking || life.thinking
            ? FPS.lively
            : life.asleep
              ? FPS.asleep
              : now - lastAttention > CALM_AFTER_MS
                ? FPS.calm
                : FPS.idle;
    },
    afterDraw: () => interaction.afterDraw(),
  };

  await listen<string>("pet://menu", async ({ payload: id }) => {
    if (id in SIZES) {
      const oldWidth = box.width;
      const oldBottom = box.y + box.height;
      layout(SIZES[id]);
      // Keep the feet where they are.
      box.x += (oldWidth - box.width) / 2;
      box.y = oldBottom - box.height;
      await win.setSize(new LogicalSize(box.width, box.height));
      await win.setPosition(new LogicalPosition(box.x, box.y));
      save({ height: SIZES[id], x: box.x, y: box.y });
      setTimeout(() => void measureFeet(), 300);
      if (SIZES[id] > texturesFor) setTimeout(() => location.reload(), 300);
    } else if (id === "chat") {
      await ui.openInput();
    } else if (id === "voice") {
      await designVoice();
    } else if (id === "speak-on" || id === "speak-off") {
      save({ speak: id === "speak-on" });
      speaker.enabled = id === "speak-on" && (await ttsStatus()).available;
      if (!speaker.enabled) speaker.stop();
      if (id === "speak-on" && !speaker.enabled) await designVoice();
    } else if (id === "watch-on") {
      const yes = await ask(
        zh
          ? "开启陪伴观察？\n\n她会每隔 4–8 分钟看一眼你的屏幕（截图发给 DeepSeek 看，不保存），平时安静，只在你遇到报错、完成了事情、在看有趣的东西或熬夜时说一句。开会、共享屏幕、密码管理器在前台、或你不在电脑前时她不看。看的时候右上角会出现 👀。随时可以在菜单里关掉。"
          : "Turn on Watch Over Me?\n\nEvery 4–8 minutes she glances at your screen (a screenshot sent to DeepSeek, never kept). She stays quiet unless you hit an error, finish something, are watching something fun, or work late. She never looks during meetings or screen sharing, with a password manager in front, or when you're away. 👀 shows while she looks. Turn it off here anytime.",
        { title: zh ? "陪伴观察" : "Watch Over Me", okLabel: zh ? "开启" : "Turn On", cancelLabel: zh ? "算了" : "Not Now" },
      );
      if (!yes) return void invoke("set_watch_menu", { checked: false });
      save({ watch: true });
      watchState = initialWatch(Date.now());
      watchState.nextGlance = Date.now() + 60_000;
      toast(zh ? "陪伴观察已开启～" : "Watch Over Me is on~");
    } else if (id === "step-aside-on" || id === "step-aside-off") {
      save({ stepAside: id === "step-aside-on" });
    } else if (id === "watch-off") {
      save({ watch: false });
      toast(zh ? "陪伴观察已关闭。" : "Watch Over Me is off.");
    } else if (id === "look") {
      await lookAtScreen(zh ? "看看我的屏幕" : "Take a look at my screen.");
    } else if (id === "focus") {
      if (focus) endFocus(false);
      else await focusUi.open(lastFocus.task);
    } else if (id === "agents") {
      await manageAgents();
    } else if (id === "pick-model") {
      const path = await pickModel();
      if (path) {
        save({ modelPath: path });
        location.reload();
      }
    } else if (id === "relearn") {
      await invoke("profile_remove", { key: learnedKey }).catch(() => {});
      await learn();
    } else if (id === "forget") {
      const sure = await ask("Forget all conversations and everything she has learned about you?", {
        title: "Forget Everything",
        kind: "warning",
        okLabel: "Forget",
        cancelLabel: "Cancel",
      });
      if (sure) {
        await invoke("memory_forget_all");
        mood.reset();
        toast("Memory cleared.");
      }
    } else if (id === "about") {
      await message(aboutText(source.dir, model, map, learned), { title: "About This Model", kind: "info" });
    }
  });

  stage.start();
  setTimeout(() => void measureFeet(), 500);
  await win.show();
  console.info(
    `[pet] ${profile.name}: ${profile.expressions.length} expressions, ${profile.motions.length} motions, ` +
      `emotions ${[...map.emotions.keys()].join("/")}, actions ${[...map.actions.keys()].join("/")}, ` +
      `textures ${(model.textureMemoryBytes / 2 ** 20).toFixed(0)} MB`,
  );

  setInterval(async () => {
    companion.tick(30);
    syncLife();
    // A MiMo key added while she runs takes effect without a restart.
    if (settings.speak !== false && !auditioning) speaker.enabled = (await ttsStatus()).available;
  }, 30_000);
  if (import.meta.env.DEV) {
    // Lets scripts drive a chat turn: echo "hi" > /tmp/logitmate-say.txt
    // or a focus session: echo "/focus 0.5 write tests" > /tmp/logitmate-say.txt
    // or parameter ranges:  echo "/params ParamAngleX AngleX" > /tmp/logitmate-say.txt
    setInterval(async () => {
      const text = await invoke<string | null>("debug_take_input");
      const focusCmd = text?.match(/^\/focus\s+([\d.]+)\s+(.+)$/);
      // The voice description she would get, without designing anything.
      if (text === "/brief") {
        const still = await stage.still(() => model.poseStill(null));
        const brief = await writeBrief(settings.characterName || profile.name, settings.persona, zh, stillJpeg(still)).catch((e) => String(e));
        console.info(`[pet] brief: ${JSON.stringify(brief)}`);
        return;
      }
      // Presence: put her feet on a window's top edge ("/dropon perchtest"), or push her past an
      // edge ("/edge left"), then settle as after a drag.
      const dropCmd = text?.match(/^\/dropon\s+(\S+)$/);
      if (dropCmd) {
        const target = (await invoke<WindowInfo[]>("list_windows")).find((w) => w.owner.toLowerCase().includes(dropCmd[1].toLowerCase()));
        if (target) {
          moveFeet(target.x + target.width / 2, target.y - 20);
          await settle();
        }
        console.info(`[pet] dropon ${dropCmd[1]}: ${target ? `window ${target.id}, perch ${JSON.stringify(perch)}` : "not found"}`);
        return;
      }
      const edgeCmd = text?.match(/^\/edge\s+(left|right)$/);
      if (edgeCmd) {
        const area = await workArea();
        if (area) moveBox(edgeCmd[1] === "left" ? area.x - box.width * 0.6 : area.x + area.width - box.width * 0.4, box.y);
        await settle();
        console.info(`[pet] edge ${edgeCmd[1]}: x ${Math.round(box.x)}`);
        return;
      }
      // One glance decision on a prepared image instead of the screen: "/watchtest /tmp/logitmate-x.jpg"
      const watchCmd = text?.match(/^\/watchtest\s+(\S+)$/);
      if (watchCmd) {
        const b64 = await invoke<string>("debug_read_image", { path: watchCmd[1] }).catch((e) => String(e));
        await watchDecide(`data:image/jpeg;base64,${b64}`, "Terminal").catch((e) => console.warn(e));
        return;
      }
      // Checks the screenshot path without sending anything: saves /tmp/logitmate-shot.jpg.
      if (text === "/shot") {
        const rect = await screenRect();
        const jpeg = await invoke<string>("screen_capture", rect ?? {}).catch((e) => String(e));
        if (jpeg.length > 100) await invoke("debug_save_image", { name: "shot", base64: jpeg });
        console.info(`[pet] shot: ${jpeg.length > 100 ? `${Math.round((jpeg.length * 3) / 4 / 1024)} KB` : jpeg}`);
        return;
      }
      // Frame parts on/off, to bisect cost or memory: "/part render off"
      const partCmd = text?.match(/^\/part\s+(hooks|update|render|after)\s+(on|off)$/);
      if (partCmd) {
        stage.debugParts[partCmd[1] as keyof typeof stage.debugParts] = partCmd[2] === "on";
        console.info(`[pet] parts ${JSON.stringify(stage.debugParts)}`);
        return;
      }
      const playCmd = text?.match(/^\/play\s+(\w+)$/);
      if (playCmd && playCmd[1] in GESTURES) life.play(playCmd[1] as GestureName);
      else if (playCmd?.[1] === "hands") reactions.gesture(undefined, 4000);
      const paramsCmd = text?.match(/^\/params\s+(.+)$/);
      // Stills posed with given values, saved as /tmp/logitmate-probe-<n>.jpg: "/probe LArm=1 LArm=-1,RArm=1"
      const probeCmd = text?.match(/^\/probe\s+(.+)$/);
      if (probeCmd) {
        for (const [i, spec] of probeCmd[1].split(/\s+/).entries()) {
          const values = Object.fromEntries(spec.split(",").map((kv) => [kv.split("=")[0], Number(kv.split("=")[1])]));
          const still = await stage.still(() => model.poseStill(null, values));
          const jpeg = stillJpeg(still);
          await invoke("debug_save_image", { name: `probe-${i}`, base64: jpeg.slice(jpeg.indexOf(",") + 1) });
        }
        console.info("[pet] probe done");
      } else if (paramsCmd) console.info(`[pet] params\n${model.describeParameters(paramsCmd[1].split(/[ ,]+/))}`);
      else if (focusCmd) startFocus(focusCmd[2], Number(focusCmd[1]));
      else if (text && !playCmd) void companion.talk(text);
    }, 1000);
  }
  const firstRun = mood.state.affection === 0 && (await invoke<unknown[]>("memory_recent", { limit: 1 })).length === 0;
  const away = mood.touch();
  if ((firstRun || away > GREET_AFTER_HOURS) && (await invoke<boolean>("has_api_key"))) {
    setTimeout(() => void companion.greet(away, firstRun), 1200);
  }
  // A new model: learn what its expressions mean in the background, after any greeting.
  if (!cached && (await invoke<boolean>("has_api_key"))) setTimeout(() => void learn(), 6000);
}

async function manageAgents(): Promise<void> {
  const st = await invoke<HookStatus>("agents_status");
  if (!st.claudeInstalled && !st.codexInstalled) {
    await message("No Claude Code or Codex configuration was found in your home folder.", { title: "Coding Agents", kind: "info" });
    return;
  }
  const connected = st.claudeConnected || st.codexConnected;
  const found = [st.claudeInstalled && "Claude Code", st.codexInstalled && "Codex"].filter(Boolean).join(" and ");
  if (connected) {
    const off = await ask(`LogitMate is connected to ${found}. Disconnect and restore your previous hook settings?`, {
      title: "Coding Agents",
      okLabel: "Disconnect",
      cancelLabel: "Keep",
    });
    if (off) {
      await invoke("agents_disconnect");
      toast("Disconnected from coding agents.");
    }
    return;
  }
  const lines = [
    `Connect LogitMate to ${found}? She will think along while they work, tell you when they need you, and cheer when long tasks finish.`,
    "",
    st.claudeInstalled ? "• Claude Code: adds one hook next to your existing ones in ~/.claude/settings.json." : "",
    st.codexInstalled ? "• Codex: runs LogitMate's hook first, then your current notify command, unchanged." : "",
    "",
    "Only metadata is used (agent, project, tool, what it waits for), never your prompts or code. Both files are backed up first, and you can disconnect here anytime.",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "");
  const yes = await ask(lines.join("\n"), { title: "Coding Agents", okLabel: "Connect", cancelLabel: "Not Now" });
  if (!yes) return;
  try {
    const after = await invoke<HookStatus>("agents_connect");
    toast(`Connected: ${[after.claudeConnected && "Claude Code", after.codexConnected && "Codex"].filter(Boolean).join(", ")}`);
  } catch (e) {
    await message(`Could not connect: ${String(e)}`, { title: "Coding Agents", kind: "error" });
  }
}

function aboutText(dir: string, model: PetModel, map: ExpressionMap, learned: LearnedProfile | null): string {
  const p = model.normalized.profile;
  const c = p.capabilities;
  const yes = (b: boolean) => (b ? "✓" : "—");
  return [
    `Model: ${p.name}`,
    `Folder: ${dir}`,
    `${p.expressions.length} expressions · ${p.motions.length} motions`,
    `Blink ${yes(c.eyeBlink)}  Physics ${yes(c.physics)}  Gaze ${yes(c.look)}  Vowel lip sync ${yes(c.vowels)}  ARKit ${yes(c.arkit)}`,
    `Emotions she can show: ${[...map.emotions].map(([e, name]) => `${e} (${map.looks.get(e) ?? name})`).join(", ") || "none"}`,
    learned
      ? `Expressions learned by ${learned.labeller} on ${new Date(learned.learnedAt).toLocaleDateString()} (Relearn Expressions to redo).`
      : "Expressions guessed from their names; she learns them properly when an API key is set.",
    `Texture memory: about ${(model.textureMemoryBytes / 2 ** 20).toFixed(0)} MB`,
    "",
    "The model belongs to its creators. LogitMate only reads it from your disk and never copies or uploads its files; to learn its expressions, small rendered stills are sent once to your LLM provider. Read the terms that came with the model and credit its creators when you share it.",
  ].join("\n");
}

main().catch(async (e) => {
  console.error(e);
  await win.show();
  toast(`Failed to load: ${e instanceof Error ? e.message : String(e)}`, 0);
});
