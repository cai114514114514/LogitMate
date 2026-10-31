// Learns what each of a model's expressions means, once per model, so any model works without setup.
//
// Every expression is rendered as a still next to the rest pose (cropped to the face plus whatever
// it changed) and a vision model labels them in small batches (DeepSeek's by default). Batches
// stay small and missing answers are retried, since large image batches drop items (GPT-4V emotion
// benchmark, arXiv 2312.04293). When images can't be used, names and parameter names decide.

import { invoke } from "@tauri-apps/api/core";
import {
  describeExpression,
  labelMessages,
  parseMeanings,
  PROFILE_VERSION,
  type ExpressionMeaning,
  type LabelItem,
  type LearnedProfile,
} from "../model/semantics";
import type { PetModel } from "../renderer/petModel";
import type { Stage } from "../renderer/stage";
import { alphaBox, boxHeight, boxWidth, diffBox, faceBox, panelBox, zoomBox, type Box, type Still } from "../renderer/stills";

const BATCH = 6;
const PANEL = 288;
const BACKGROUND = [236, 236, 240];
/** Eyes shut and mouth open, to find the face on any standard rig. */
const FACE_PROBE = { ParamEyeLOpen: 0, ParamEyeROpen: 0, ParamMouthOpenY: 1, ParamMouthForm: -1 };

export async function loadLearned(key: string): Promise<LearnedProfile | null> {
  const text = await invoke<string | null>("profile_load", { key }).catch(() => null);
  if (!text) return null;
  try {
    const p = JSON.parse(text) as LearnedProfile;
    return p.version === PROFILE_VERSION && Array.isArray(p.expressions) ? p : null;
  } catch {
    return null;
  }
}

export interface LearnOptions {
  stage: Stage;
  model: PetModel;
  key: string;
  onProgress?: (text: string) => void;
}

export async function learnExpressions({ stage, model, key, onProgress }: LearnOptions): Promise<LearnedProfile> {
  const profile = model.normalized.profile;
  const progress = onProgress ?? (() => {});

  // Stills: rest pose, the face probe, then each expression.
  const rest = await stage.still(() => model.poseStill(null));
  const probe = await stage.still(() => model.poseStill(null, FACE_PROBE));
  const body = alphaBox(rest) ?? { x0: 0, y0: 0, x1: rest.width, y1: rest.height };
  const face = faceBox(rest, probe, body);

  const items: LabelItem[] = [];
  for (const [i, e] of profile.expressions.entries()) {
    progress(`Looking at her expressions… ${i + 1}/${profile.expressions.length}`);
    const still = await stage.still(() => model.poseStill(e.name));
    const changed = diffBox(rest, still);
    const evidence = describeExpression(e, model.expressionParameters(e.name), profile.parameterNames);
    let image: string | undefined;
    if (changed) {
      const panel = panelBox(face, changed, rest.width, rest.height);
      image = sideBySide(rest, still, panel, zoomBox(changed, panel, rest.width, rest.height));
    }
    if (image && import.meta.env.DEV) {
      void invoke("debug_save_image", { name: `still-${i}`, base64: image.slice(image.indexOf(",") + 1) }).catch(() => {});
    }
    items.push({ name: e.name, evidence, image, visible: !!changed });
  }

  const vision = await invoke<string>("llm_vision_model");
  let useImages = true;
  const meanings = new Map<string, ExpressionMeaning>();
  const ask = async (batch: LabelItem[], withImages: boolean) => {
    const reply = await invoke<string>("llm_complete", { messages: labelMessages(batch, withImages), json: true, vision: withImages });
    return parseMeanings(reply, batch.map((b) => b.name), withImages ? "vision" : "text");
  };

  const batches: LabelItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  let done = 0;
  await Promise.all(
    batches.map(async (batch) => {
      let got = new Map<string, ExpressionMeaning>();
      if (useImages) {
        try {
          got = await ask(batch, true);
          const missing = batch.filter((b) => !got.has(b.name));
          if (missing.length) for (const [k, v] of await ask(missing, true)) got.set(k, v);
        } catch (e) {
          if (isFatal(e)) throw e;
          // The endpoint refused images: label from names for the rest of this run.
          console.warn("[pet] labelling with images failed, using names", e);
          useImages = false;
        }
      }
      const missing = batch.filter((b) => !got.has(b.name));
      if (missing.length) for (const [k, v] of await ask(missing, false)) got.set(k, v);
      for (const [k, v] of got) meanings.set(k, v);
      done += batch.length;
      progress(`Learning what her expressions mean… ${done}/${items.length}`);
    }),
  );

  const learned: LearnedProfile = {
    version: PROFILE_VERSION,
    labeller: [...meanings.values()].some((m) => m.from === "vision") ? vision : "names only",
    learnedAt: new Date().toISOString(),
    expressions: profile.expressions.map((e) => meanings.get(e.name)).filter((m): m is ExpressionMeaning => !!m),
  };
  await invoke("profile_save", { key, json: JSON.stringify(learned) });
  return learned;
}

/** No key or no network: nothing to fall back to. */
function isFatal(e: unknown): boolean {
  const msg = String(e);
  return msg.includes("NO_API_KEY") || msg.startsWith("network");
}

/**
 * JPEG data URL on a light background: the rest pose and the expression with the same crop, plus a
 * close-up of the change when it is small.
 */
function sideBySide(rest: Still, still: Still, box: Box, zoom: Box | null): string {
  const panels: [Still, Box][] = [[rest, box], [still, box]];
  if (zoom) panels.push([still, zoom]);
  const canvas = document.createElement("canvas");
  canvas.width = PANEL * panels.length;
  canvas.height = PANEL;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `rgb(${BACKGROUND.join(",")})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  panels.forEach(([s, b], i) => {
    const scale = Math.min(PANEL / boxWidth(b), PANEL / boxHeight(b));
    const w = Math.round(boxWidth(b) * scale);
    const h = Math.round(boxHeight(b) * scale);
    ctx.drawImage(crop(s, b), i * PANEL + (PANEL - w) / 2, (PANEL - h) / 2, w, h);
    if (i > 0) {
      ctx.fillStyle = "rgb(190,190,198)";
      ctx.fillRect(i * PANEL - 1, 0, 2, PANEL);
    }
  });
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** The whole still as a JPEG data URL (development tools). */
export function stillJpeg(s: Still): string {
  return crop(s, { x0: 0, y0: 0, x1: s.width, y1: s.height }).toDataURL("image/jpeg", 0.85);
}

/** Cuts `box` out of a still, flattened onto the background (stills are premultiplied). */
function crop(s: Still, box: Box): HTMLCanvasElement {
  const w = boxWidth(box);
  const h = boxHeight(box);
  const data = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((box.y0 + y) * s.width + box.x0 + x) * 4;
      const dst = (y * w + x) * 4;
      const keep = 1 - s.pixels[src + 3] / 255;
      for (let c = 0; c < 3; c++) data.data[dst + c] = Math.min(255, s.pixels[src + c] + BACKGROUND[c] * keep);
      data.data[dst + 3] = 255;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return canvas;
}
