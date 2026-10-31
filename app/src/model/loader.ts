// Reads a model folder through Tauri and normalizes it.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { normalizeModel } from "./adapter";
import type { Cdi3Json, Model3Json, NormalizedModel, VtubeJson } from "./types";

interface ModelFiles {
  dir: string;
  model3File: string;
  files: string[];
}

export interface ModelSource {
  dir: string;
  files: string[];
  normalized: NormalizedModel;
  /** URL for a path relative to the model folder. */
  url: (relativePath: string) => string;
}

export async function readModelSource(model3Path: string): Promise<ModelSource> {
  const listing = await invoke<ModelFiles>("list_model_files", { model3Path });
  const url = (rel: string) => convertFileSrc(`${listing.dir}/${rel.replace(/^\.\//, "")}`);
  const readJson = async <T>(rel: string | undefined): Promise<T | null> => {
    if (!rel) return null;
    const res = await fetch(url(rel));
    return res.ok ? ((await res.json()) as T) : null;
  };

  const model3 = await readJson<Model3Json>(listing.model3File);
  if (!model3?.FileReferences?.Moc) throw new Error(`${listing.model3File} 不是有效的 model3.json`);
  const vtubeFile = listing.files.find((f) => f.toLowerCase().endsWith(".vtube.json"));
  const [vtube, cdi] = await Promise.all([
    readJson<VtubeJson>(vtubeFile),
    readJson<Cdi3Json>(model3.FileReferences.DisplayInfo),
  ]);

  const normalized = normalizeModel({ model3, model3File: listing.model3File, files: listing.files, vtube, cdi });
  return { dir: listing.dir, files: listing.files, normalized, url };
}
