import "./log";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { ask, message, open } from "@tauri-apps/plugin-dialog";
import { AgentFace, type AgentEvent } from "./behavior/agentFace";
import { Companion } from "./behavior/companion";
import { addFocusToday, FocusSession, focusLines, type FrontApp } from "./behavior/focus";
import { Interaction, type WindowBox } from "./behavior/interaction";
import { Mood } from "./behavior/mood";
import { Reactions } from "./behavior/reactions";
import { ChatSession } from "./brain/chat";
import { buildExpressionMap, type ExpressionMap } from "./brain/expressions";
import { learnExpressions, loadLearned } from "./brain/labeler";
import { systemPrompt } from "./brain/prompt";
import { readModelSource } from "./model/loader";
import { profileKey, type LearnedProfile } from "./model/semantics";
import { PetModel } from "./renderer/petModel";
import { Stage, startCubism } from "./renderer/stage";
import { ChatUI } from "./ui/chatUi";
import { FocusUI } from "./ui/focusUi";

interface Settings {
  modelPath?: string | null;
  height?: number | null;
  x?: number | null;
  y?: number | null;
  characterName?: string | null;
  persona?: string | null;
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
  const model = await PetModel.load(stage.gl, source.normalized, {
    url: source.url,
    canvasWidth: stage.canvas.width,
    canvasHeight: stage.canvas.height,
    maxDisplayHeightPx: SIZES["size-l"] * dpr,
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
      actions: [...map.actions.keys()],
      now: new Date(),
      locale: navigator.language,
    }),
  );
  const companion = new Companion({ chat, ui, reactions, mood, map });

  // Agent Face: coding agents report through the Rust bridge; she reacts without intruding.
  const agentFace = new AgentFace((r) => {
    if (r.type === "thinking") {
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
  ui.onSubmit = (text) => void companion.talk(text);
  canvas.addEventListener("dblclick", () => void ui.openInput());

  const interaction = new Interaction(stage, box, {
    onTap: (fy) => {
      companion.noteInteraction();
      if (fy < 0.32) {
        mood.onPat();
        reactions.pat();
      } else {
        mood.touch();
        reactions.gesture();
      }
    },
    moveTo: (x, y) => {
      box.x = x;
      box.y = y;
      win.setPosition(new LogicalPosition(x, y));
    },
    onDragEnd: () => save({ x: box.x, y: box.y }),
  });
  await interaction.attach();
  stage.hooks = {
    beforeUpdate: (dt) => interaction.beforeUpdate(dt),
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
    } else if (id === "chat") {
      await ui.openInput();
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
  await win.show();
  console.info(
    `[pet] ${profile.name}: ${profile.expressions.length} expressions, ${profile.motions.length} motions, ` +
      `emotions ${[...map.emotions.keys()].join("/")}, actions ${[...map.actions.keys()].join("/")}, ` +
      `textures ${(model.textureMemoryBytes / 2 ** 20).toFixed(0)} MB`,
  );

  setInterval(() => companion.tick(30), 30_000);
  if (import.meta.env.DEV) {
    // Lets scripts drive a chat turn: echo "hi" > /tmp/logitmate-say.txt
    // or a focus session: echo "/focus 0.5 write tests" > /tmp/logitmate-say.txt
    setInterval(async () => {
      const text = await invoke<string | null>("debug_take_input");
      const focusCmd = text?.match(/^\/focus\s+([\d.]+)\s+(.+)$/);
      if (focusCmd) startFocus(focusCmd[2], Number(focusCmd[1]));
      else if (text) void companion.talk(text);
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
