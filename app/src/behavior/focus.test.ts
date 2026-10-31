import { describe, expect, it } from "vitest";
import { ADOPT_MS, DRIFT_MS, FocusSession, LEARN_MS, NUDGE_COOLDOWN_MS } from "./focus";

const MIN = 60_000;
const editor = { name: "Code", bundle: "com.microsoft.VSCode" };
const browser = { name: "Safari", bundle: "com.apple.Safari" };
const video = { name: "bilibili", bundle: "tv.danmaku.bilimac" };
const notes = { name: "Notes", bundle: "com.apple.Notes" };

/** Feeds `app` every 5 s from `from` to `to` (ms after start) and collects the signals. */
function run(s: FocusSession, app: typeof editor, from: number, to: number) {
  const out: string[] = [];
  for (let t = from; t <= to; t += 5000) {
    const sig = s.observe(app, t);
    if (sig) out.push(sig.type);
  }
  return out;
}

describe("FocusSession", () => {
  it("learns the task's apps, nudges once after a drift and names the task on return", () => {
    const s = new FocusSession("report", 50, 0, () => 0.99);
    expect(run(s, editor, 0, LEARN_MS / 2)).toEqual([]);
    expect(run(s, browser, LEARN_MS / 2, LEARN_MS)).toEqual([]); // used early: part of the work
    expect(run(s, video, LEARN_MS + 1000, LEARN_MS + DRIFT_MS + 5000)).toEqual(["drift"]);
    // No second nudge within the cooldown.
    expect(run(s, video, LEARN_MS + DRIFT_MS + 10_000, LEARN_MS + NUDGE_COOLDOWN_MS - 5000)).toEqual([]);
    expect(run(s, browser, LEARN_MS + NUDGE_COOLDOWN_MS, LEARN_MS + NUDGE_COOLDOWN_MS)).toEqual(["back"]);
  });

  it("never treats leisure apps as work, even early on", () => {
    const s = new FocusSession("report", 50, 0);
    expect(run(s, video, 0, DRIFT_MS + 5000)).toEqual(["drift"]);
  });

  it("quietly adopts an app you keep using after an aside", () => {
    const s = new FocusSession("report", 60, 0, () => 0.99);
    run(s, editor, 0, LEARN_MS + 1000);
    const t0 = LEARN_MS + 5000;
    expect(run(s, notes, t0, t0 + DRIFT_MS)).toEqual(["drift"]);
    expect(run(s, notes, t0 + DRIFT_MS + 5000, t0 + ADOPT_MS + 5000)).toEqual([]);
    // Notes is work now: no drift, no "back" when switching to the editor and back.
    expect(run(s, editor, t0 + ADOPT_MS + 10_000, t0 + ADOPT_MS + 10_000)).toEqual([]);
    expect(run(s, notes, t0 + ADOPT_MS + 15_000, t0 + ADOPT_MS + 15_000 + DRIFT_MS + 30_000)).toEqual([]);
  });

  it("murmurs now and then while you work, ignores itself, and finishes on time", () => {
    const s = new FocusSession("report", 25, 0, () => 0);
    const signals = run(s, editor, 0, 24 * MIN);
    expect(signals).toEqual(["murmur", "murmur"]); // every 11 minutes with random() = 0
    expect(s.observe({ name: "LogitMate", bundle: "com.logit.mate" }, 24.5 * MIN)).toBeNull();
    expect(s.observe(null, 25 * MIN)).toEqual({ type: "done" });
    expect(s.observe(editor, 26 * MIN)).toBeNull();
    expect(s.focusedMinutes(30 * MIN)).toBe(25);
    expect(s.remainingMs(30 * MIN)).toBe(0);
  });
});
