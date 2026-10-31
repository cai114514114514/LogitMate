// ModelAdapter: turns whatever a model folder ships with into one complete model3.json plus a profile.
//
// Many models (especially ones made for VTube Studio) leave Expressions and Motions out of
// model3.json and keep them only in the folder or in *.vtube.json hotkeys. We merge every
// source we can find, in memory; the files on disk are never modified.

import type {
  Cdi3Json,
  Model3Json,
  Model3Motion,
  ModelCapabilities,
  NormalizedModel,
  ProfileExpression,
  ProfileMotion,
  VtubeJson,
} from "./types";

export const IDLE_GROUP = "Idle";
export const ACTION_GROUP = "Action";

const VOWEL_IDS = ["ParamA", "ParamI", "ParamU", "ParamE", "ParamO"];
const ARKIT_IDS = ["JawOpen", "MouthSmile_L", "MouthSmile_R", "MouthFunnel", "CheeckPuff", "CheekPuff"];

export interface AdapterInput {
  model3: Model3Json;
  /** model3.json file name, used for the fallback model name. */
  model3File: string;
  /** Every file in the model folder, relative to it, with "/" separators. */
  files: string[];
  vtube?: VtubeJson | null;
  cdi?: Cdi3Json | null;
  /** Parameter ids read from the moc at runtime; used when there is no cdi3.json. */
  parameterIds?: string[];
}

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const stripExt = (p: string, ext: string) => (p.toLowerCase().endsWith(ext) ? p.slice(0, -ext.length) : p);
const isIdleName = (p: string) => /(^|[^a-z])idle([^a-z]|$)/i.test(basename(p)) || /待机|待機/.test(basename(p));

/** Finds a folder file by exact relative path, then by base name (VTS stores bare names). */
function resolveFile(files: string[], ref: string | undefined): string | null {
  if (!ref) return null;
  const norm = ref.replace(/\\/g, "/").replace(/^\.\//, "");
  if (files.includes(norm)) return norm;
  const base = basename(norm).toLowerCase();
  return files.find((f) => basename(f).toLowerCase() === base) ?? null;
}

export function normalizeModel(input: AdapterInput): NormalizedModel {
  const { files } = input;
  const model3: Model3Json = structuredClone(input.model3);
  const refs = model3.FileReferences;
  const sources: string[] = ["model3.json"];
  const vtube = input.vtube ?? null;
  if (vtube) sources.push("vtube.json");

  // ---- Expressions: model3 first, then VTS hotkeys (for labels), then any loose exp3 files.
  const expressions: ProfileExpression[] = [];
  const seenExpFiles = new Set<string>();
  const usedNames = new Set<string>();
  const addExpression = (file: string, label: string) => {
    if (seenExpFiles.has(file)) return;
    seenExpFiles.add(file);
    let name = label;
    for (let i = 2; usedNames.has(name); i++) name = `${label} ${i}`;
    usedNames.add(name);
    expressions.push({ name, file, label });
  };
  for (const e of refs.Expressions ?? []) {
    const file = resolveFile(files, e.File);
    if (file) addExpression(file, e.Name);
  }
  for (const h of vtube?.Hotkeys ?? []) {
    if (h.Action !== "ToggleExpression") continue;
    const file = resolveFile(files, h.File);
    if (file) addExpression(file, h.Name || stripExt(basename(file), ".exp3.json"));
  }
  const looseExp = files.filter((f) => f.toLowerCase().endsWith(".exp3.json") && !seenExpFiles.has(f));
  if (looseExp.length) sources.push("folder scan (expressions)");
  for (const f of looseExp.sort()) addExpression(f, stripExt(basename(f), ".exp3.json"));

  // ---- Motions: keep declared groups; add an Idle group and an Action group from the other sources.
  const groups: Record<string, Model3Motion[]> = structuredClone(refs.Motions ?? {});
  const motions: ProfileMotion[] = [];
  const seenMotionFiles = new Set<string>();
  const labelFor = new Map<string, { label: string; hold: boolean }>();
  for (const h of vtube?.Hotkeys ?? []) {
    if (h.Action !== "TriggerAnimation") continue;
    const file = resolveFile(files, h.File);
    if (file) labelFor.set(file, { label: h.Name || stripExt(basename(file), ".motion3.json"), hold: !!h.StopsOnLastFrame });
  }
  const pushMotion = (group: string, entry: Model3Motion) => {
    const file = resolveFile(files, entry.File) ?? entry.File;
    groups[group] ??= [];
    if (!groups[group].some((m) => m.File === entry.File)) groups[group].push(entry);
    const index = groups[group].findIndex((m) => m.File === entry.File);
    const meta = labelFor.get(file);
    seenMotionFiles.add(file);
    motions.push({
      group,
      index,
      file,
      label: meta?.label ?? stripExt(basename(file), ".motion3.json"),
      holdLastFrame: meta?.hold ?? false,
    });
  };
  for (const [group, list] of Object.entries(refs.Motions ?? {})) {
    for (const m of list) pushMotion(group, m);
  }

  let idleGroup = Object.keys(groups).find((g) => g.toLowerCase() === "idle") ?? null;
  if (!idleGroup) {
    const idleFile =
      resolveFile(files, vtube?.FileReferences?.IdleAnimation) ??
      files.find((f) => f.toLowerCase().endsWith(".motion3.json") && isIdleName(f)) ??
      null;
    if (idleFile) {
      idleGroup = IDLE_GROUP;
      pushMotion(IDLE_GROUP, { File: idleFile, FadeInTime: 0.5, FadeOutTime: 0.5 });
    }
  }

  const otherMotions = files
    .filter((f) => f.toLowerCase().endsWith(".motion3.json") && !seenMotionFiles.has(f))
    .sort();
  if (otherMotions.length) sources.push("folder scan (motions)");
  for (const f of otherMotions) pushMotion(ACTION_GROUP, { File: f, FadeInTime: 0.3, FadeOutTime: 0.3 });

  refs.Expressions = expressions.map((e) => ({ Name: e.name, File: e.file }));
  refs.Motions = groups;

  // ---- Parameters and capabilities.
  const parameterNames: Record<string, string> = {};
  for (const p of input.cdi?.Parameters ?? []) parameterNames[p.Id] = p.Name;
  if (input.cdi) sources.push("cdi3.json");
  const ids = new Set<string>([...Object.keys(parameterNames), ...(input.parameterIds ?? [])]);
  const has = (id: string) => ids.has(id);

  model3.Groups = structuredClone(model3.Groups ?? []);
  const group = (name: string) => model3.Groups!.find((g) => g.Name === name && g.Target === "Parameter");
  const ensureGroup = (name: string, fallback: string[]) => {
    let g = group(name);
    if (!g) {
      g = { Target: "Parameter", Name: name, Ids: [] };
      model3.Groups!.push(g);
    }
    if (g.Ids.length === 0) g.Ids = fallback.filter(has);
    return g.Ids;
  };
  const eyeBlinkIds = ensureGroup("EyeBlink", ["ParamEyeLOpen", "ParamEyeROpen"]);
  const lipSyncIds = ensureGroup("LipSync", ["ParamMouthOpenY"]);

  const capabilities: ModelCapabilities = {
    eyeBlink: eyeBlinkIds.length > 0,
    lipSyncIds: [...lipSyncIds],
    vowels: VOWEL_IDS.every(has),
    arkit: ARKIT_IDS.filter(has).length >= 3,
    physics: !!refs.Physics && files.includes(refs.Physics),
    breath: has("ParamBreath"),
    look: has("ParamAngleX") && has("ParamAngleY"),
  };

  const name = vtube?.Name || stripExt(basename(input.model3File), ".model3.json");
  return {
    model3,
    profile: { name, expressions, motions, idleGroup, capabilities, parameterNames, sources },
  };
}
