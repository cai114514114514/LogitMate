import { describe, expect, it } from "vitest";
import { Mood } from "./mood";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("Mood", () => {
  it("drifts back to the baseline with a 10-minute half-life", () => {
    const mood = new Mood(memoryStorage());
    mood.state.mood = 1;
    mood.tick(600);
    expect(mood.state.mood).toBeCloseTo(0.6, 5);
  });

  it("persists and reports time away", () => {
    let now = Date.UTC(2026, 9, 31, 10);
    const storage = memoryStorage();
    const a = new Mood(storage, () => now);
    a.onPat();
    a.onPat();
    now += 5 * 3_600_000;
    const b = new Mood(storage, () => now);
    expect(b.state.affection).toBe(2);
    expect(b.touch()).toBeCloseTo(5);
    expect(b.touch()).toBeCloseTo(0);
  });

  it("is sleepy at night and lively in the afternoon", () => {
    const mood = new Mood(null);
    expect(mood.energy(new Date(2026, 9, 31, 3, 0))).toBeLessThan(0.3);
    expect(mood.energy(new Date(2026, 9, 31, 15, 0))).toBe(1);
  });

  it("clamps mood and survives corrupt storage", () => {
    const storage = memoryStorage();
    storage.setItem("logitmate.mood", "{not json");
    const mood = new Mood(storage);
    for (let i = 0; i < 30; i++) mood.onEmotion("angry");
    expect(mood.state.mood).toBe(-1);
    expect(mood.describe()).toContain("down");
  });
});
