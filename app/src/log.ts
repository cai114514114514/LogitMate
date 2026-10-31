// Mirrors webview console output to the app's stdout, so `tauri dev` logs show frontend errors.
import { invoke } from "@tauri-apps/api/core";

for (const level of ["info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    const text = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    invoke("log", { level, text }).catch(() => {});
  };
}
window.addEventListener("error", (e) => console.error(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => console.error(e.reason));
