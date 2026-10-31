import "./log";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { message, open } from "@tauri-apps/plugin-dialog";
import { Interaction, type WindowBox } from "./behavior/interaction";
import { Reactions } from "./behavior/reactions";
import { readModelSource } from "./model/loader";
import { PetModel } from "./renderer/petModel";
import { Stage, startCubism } from "./renderer/stage";

interface Settings {
  modelPath?: string | null;
  height?: number | null;
  x?: number | null;
  y?: number | null;
}

const SIZES: Record<string, number> = { "size-s": 420, "size-m": 600, "size-l": 820 };
const MARGIN = 24;

const win = getCurrentWindow();
const toastEl = document.getElementById("toast")!;

function toast(text: string, ms = 4000): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  if (ms > 0) setTimeout(() => (toastEl.hidden = true), ms);
}

async function pickModel(): Promise<string | null> {
  const path = await open({
    title: "选择 Live2D 模型（*.model3.json）",
    multiple: false,
    directory: false,
    filters: [{ name: "Live2D 模型", extensions: ["json"] }],
  });
  if (!path) return null;
  if (!path.toLowerCase().endsWith(".model3.json")) {
    await message("请选择以 .model3.json 结尾的文件。", { title: "LogitMate", kind: "warning" });
    return null;
  }
  return path;
}

/** Bottom-right of the screen's usable area, in logical pixels. */
async function defaultPosition(width: number, height: number): Promise<{ x: number; y: number }> {
  const mon = await currentMonitor();
  if (!mon) return { x: 100, y: 100 };
  const area = mon.workArea ?? { position: mon.position, size: mon.size };
  const s = mon.scaleFactor;
  return {
    x: (area.position.x + area.size.width) / s - width - MARGIN,
    y: (area.position.y + area.size.height) / s - height,
  };
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const step = (what: string) => console.info(`[pet] ${what} +${Math.round(performance.now() - t0)}ms`);
  step("boot");
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
    toast("请选择一个 Live2D 模型", 0);
    modelPath = await pickModel();
    if (!modelPath) return toast("没有选择模型，可从菜单栏图标重新选择。", 0);
    save({ modelPath });
  }

  startCubism();
  const stage = new Stage(document.getElementById("stage") as HTMLCanvasElement);
  const source = await readModelSource(modelPath);
  step("model folder read");
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

  const height = settings.height ?? SIZES["size-m"];
  const box: WindowBox = { x: 0, y: 0, width: Math.round(height * model.aspect()), height };
  const fallback = await defaultPosition(box.width, box.height);
  box.x = settings.x ?? fallback.x;
  box.y = settings.y ?? fallback.y;
  await win.setSize(new LogicalSize(box.width, box.height));
  await win.setPosition(new LogicalPosition(box.x, box.y));

  const reactions = new Reactions(model);
  const interaction = new Interaction(stage, box, {
    onTap: (_x, y) => reactions.tap(y / box.height),
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
      const h = SIZES[id];
      const w = Math.round(h * model.aspect());
      // Keep the feet where they are.
      box.x += (box.width - w) / 2;
      box.y += box.height - h;
      Object.assign(box, { width: w, height: h });
      await win.setSize(new LogicalSize(w, h));
      await win.setPosition(new LogicalPosition(box.x, box.y));
      save({ height: h, x: box.x, y: box.y });
    } else if (id === "pick-model") {
      const path = await pickModel();
      if (path) {
        save({ modelPath: path });
        location.reload();
      }
    } else if (id === "about") {
      await message(aboutText(source.dir, model), { title: "关于模型", kind: "info" });
    }
  });

  stage.start();
  await win.show();
  const p = model.normalized.profile;
  console.info(
    `[pet] ${p.name}: ${p.expressions.length} expressions, ${p.motions.length} motions, ` +
      `textures ${(model.textureMemoryBytes / 2 ** 20).toFixed(0)} MB, sources: ${p.sources.join(", ")}`,
  );
}

function aboutText(dir: string, model: PetModel): string {
  const p = model.normalized.profile;
  const c = p.capabilities;
  const yes = (b: boolean) => (b ? "✓" : "—");
  return [
    `模型：${p.name}`,
    `目录：${dir}`,
    `表情 ${p.expressions.length} 个 · 动作 ${p.motions.length} 个`,
    `眨眼 ${yes(c.eyeBlink)}  物理 ${yes(c.physics)}  视线 ${yes(c.look)}  元音口型 ${yes(c.vowels)}  ARKit ${yes(c.arkit)}`,
    `贴图显存约 ${(model.textureMemoryBytes / 2 ** 20).toFixed(0)} MB`,
    "",
    "模型版权归原作者所有。LogitMate 只读取本地文件，不复制、不上传模型；公开使用前请阅读模型附带的使用条款并注明作者。",
  ].join("\n");
}

main().catch(async (e) => {
  console.error(e);
  await win.show();
  toast(`加载失败：${e instanceof Error ? e.message : String(e)}`, 0);
});
