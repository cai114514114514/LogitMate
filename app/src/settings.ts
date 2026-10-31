// The Settings window: her persona for the current model, and API keys.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { loadPersona, savePersona } from "./brain/persona";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nameInput = $<HTMLInputElement>("name");
const personaInput = $<HTMLTextAreaElement>("persona");
const personaStatus = $("persona-status");
const keysStatus = $("keys-status");
const draftButton = $<HTMLButtonElement>("draft");

async function main(): Promise<void> {
  const settings = await invoke<{ modelPath?: string | null }>("get_settings");
  const modelPath = settings.modelPath ?? "";
  const file = modelPath.slice(modelPath.lastIndexOf("/") + 1);
  $("model-name").textContent = file.replace(/\.model3\.json$/i, "") || "no model";

  const persona = modelPath ? await loadPersona(modelPath) : null;
  nameInput.value = persona?.name ?? "";
  personaInput.value = persona?.persona ?? "";
  if (!persona) personaStatus.textContent = "No persona yet. Write one, or let her draft one from how she looks.";

  $("save-persona").addEventListener("click", async () => {
    if (!modelPath) return;
    // The voice description belongs to the designed voice; keep it.
    const voice = (await loadPersona(modelPath))?.voice;
    await savePersona(modelPath, { name: nameInput.value, persona: personaInput.value, voice });
    await emit("persona:changed");
    personaStatus.textContent = "Saved. She'll be herself from the next thing she says.";
  });

  // Drafting needs a still of the character, which only the pet window can render.
  draftButton.addEventListener("click", async () => {
    draftButton.disabled = true;
    personaStatus.textContent = "She's looking at herself and thinking about who she is…";
    await emit("persona:draft");
  });
  await listen<{ name: string; persona: string }>("persona:drafted", ({ payload }) => {
    nameInput.value = payload.name;
    personaInput.value = payload.persona;
    draftButton.disabled = false;
    personaStatus.textContent = "Draft ready. Edit it as you like, then Save.";
  });
  await listen<string>("persona:draft-failed", ({ payload }) => {
    draftButton.disabled = false;
    personaStatus.textContent = `Couldn't draft a persona: ${payload}`;
  });

  await showKeys();
  $("save-keys").addEventListener("click", async () => {
    const saved: string[] = [];
    for (const service of ["deepseek", "mimo"]) {
      const input = $<HTMLInputElement>(`${service}-key`);
      const key = input.value.trim();
      if (!key) continue;
      try {
        await invoke("set_api_key", { serviceName: service, key });
        input.value = "";
        saved.push(service === "deepseek" ? "DeepSeek" : "MiMo");
      } catch (e) {
        keysStatus.textContent = `Couldn't save: ${String(e)}`;
        return;
      }
    }
    keysStatus.textContent = saved.length ? `Saved ${saved.join(" and ")} to the Keychain.` : "Nothing to save.";
    await showKeys();
  });
}

async function showKeys(): Promise<void> {
  const status = await invoke<Record<string, boolean>>("key_status");
  for (const service of ["deepseek", "mimo"]) {
    const badge = $(`${service}-state`);
    badge.textContent = status[service] ? "✓ set" : "not set";
    badge.classList.toggle("set", !!status[service]);
  }
}

main().catch((e) => {
  personaStatus.textContent = `Failed to load: ${String(e)}`;
});
