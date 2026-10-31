import { describe, expect, it } from "vitest";
import { Gaze, Life, PointerSense, Talker, type PointerState } from "./life";

const away: PointerState = { x: 0, y: 0, fx: 5, fy: 5, stillMs: 1e9, near: false, over: false };
/** A repeatable pseudo-random sequence. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("Talker", () => {
  it("moves the mouth one syllable per character, pauses at punctuation, nods at sentence ends", () => {
    const t = new Talker(() => 0.5);
    t.feed("你好。");
    let open = 0;
    let ends = 0;
    let time = 0;
    while (t.talking && time < 5) {
      const m = t.update(1 / 60);
      open = Math.max(open, m.open);
      if (m.sentenceEnd) ends++;
      time += 1 / 60;
    }
    expect(open).toBeGreaterThan(0.5);
    expect(ends).toBe(1);
    // Two syllables at 6.5/s plus a 0.32 s pause.
    expect(time).toBeGreaterThan(0.6);
    expect(time).toBeLessThan(0.75);
    expect(t.update(1 / 60).open).toBe(0);
  });

  it("stresses the first syllable of each phrase and every fourth after it", () => {
    const t = new Talker(() => 0.5);
    t.feed("一二三四五六，七八");
    const stresses: number[] = [];
    let syllable = 0;
    while (t.talking) {
      const m = t.update(1 / 120);
      if (m.stress) stresses.push(syllable);
      if (m.open > 0.99 * 0.775) syllable++;
    }
    expect(stresses.length).toBe(3); // 一, 五, 七
  });

  it("never falls far behind a fast stream", () => {
    const t = new Talker(() => 0.5);
    t.feed("字".repeat(500));
    let time = 0;
    while (t.talking) {
      t.update(0.05);
      time += 0.05;
    }
    expect(time).toBeLessThan(10);
  });
});

describe("PointerSense", () => {
  it("treats back-and-forth strokes on her head as petting", () => {
    const s = new PointerSense();
    let petted = 0;
    let t = 0;
    for (let i = 0; i < 60; i++) {
      t += 1 / 60;
      const fx = 0.5 + 0.12 * Math.sin(i / 4);
      const r = s.feed({ ...away, fx, fy: 0.12, near: true, over: true, stillMs: 0 }, t, 1 / 60);
      if (r.startedPetting) petted++;
    }
    expect(petted).toBe(1);
  });

  it("gets dizzy when the cursor is shaken at her, then cools down", () => {
    const s = new PointerSense();
    let dizzy = 0;
    let t = 0;
    for (let i = 0; i < 240; i++) {
      t += 1 / 60;
      const fx = 0.5 + 0.6 * Math.sign(Math.sin(i * 1.3));
      if (s.feed({ ...away, fx, fy: 0.6, near: true, stillMs: 0 }, t, 1 / 60).dizzy) dizzy++;
    }
    expect(dizzy).toBe(1);
  });
});

describe("Gaze", () => {
  it("follows the cursor, wanders when idle, and looks down at her work", () => {
    const g = new Gaze(seeded());
    g.update(0, "cursor", { x: 0.7, y: -0.2 });
    expect(g.eye).toEqual({ x: 0.7, y: -0.2 });
    const seen = new Set<string>();
    for (let t = 0; t < 30; t += 0.1) {
      g.update(t, "idle", { x: 0, y: 0 });
      expect(Math.abs(g.eye.x)).toBeLessThanOrEqual(0.9);
      expect(Math.abs(g.head.x)).toBeLessThanOrEqual(Math.abs(g.eye.x) + 1e-9);
      seen.add(`${g.eye.x.toFixed(3)},${g.eye.y.toFixed(3)}`);
    }
    expect(seen.size).toBeGreaterThan(8);
    g.update(31, "work", { x: 0, y: 0 });
    expect(g.eye.y).toBeLessThan(-0.3);
  });
});

describe("Life", () => {
  it("dozes off when nobody is around and wakes, startled, when the cursor comes near", () => {
    const life = new Life(seeded(7));
    life.energy = 0.3;
    const events: string[] = [];
    life.onEvent = (e) => events.push(e.type);
    let frame = life.update(0.1, away);
    for (let t = 0; t < 200; t += 0.5) frame = life.update(0.5, away);
    expect(events).toContain("dozed");
    expect(frame.eyeOpen).toBeLessThan(0.2);
    frame = life.update(0.1, { x: 0.2, y: 0.1, fx: 0.5, fy: 0.5, stillMs: 50, near: true, over: false });
    expect(events).toContain("woke");
    for (let i = 0; i < 20; i++) frame = life.update(0.1, { ...away, stillMs: 100, near: true });
    expect(frame.eyeOpen).toBeGreaterThan(0.9);
  });

  it("keeps her moving on her own and opens her mouth when she speaks", () => {
    const life = new Life(seeded(3));
    const angles: number[] = [];
    for (let i = 0; i < 300; i++) angles.push(life.update(1 / 30, away).offsets.ParamAngleX);
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(1);
    life.speak("你好呀");
    let mouth = 0;
    for (let i = 0; i < 30; i++) mouth = Math.max(mouth, life.update(1 / 60, away).offsets.ParamMouthOpenY ?? 0);
    expect(mouth).toBeGreaterThan(0.4);
  });

  it("does not doze off on someone who is typing, and wakes when they type", () => {
    const life = new Life(seeded(9));
    life.energy = 0.3;
    const events: string[] = [];
    life.onEvent = (e) => events.push(e.type);
    life.inputIdleMs = 2000;
    for (let t = 0; t < 400; t += 1) life.update(1, away);
    expect(events).not.toContain("dozed");
    life.inputIdleMs = Infinity;
    for (let t = 0; t < 400; t += 1) life.update(1, away);
    expect(events).toContain("dozed");
    life.inputIdleMs = 200;
    life.update(0.1, away);
    expect(events).toContain("woke");
  });

  it("never dozes in a focus session", () => {
    const life = new Life(seeded(5));
    life.energy = 0.2;
    life.working = true;
    const events: string[] = [];
    life.onEvent = (e) => events.push(e.type);
    for (let t = 0; t < 900; t += 1) life.update(1, away);
    expect(events).not.toContain("dozed");
  });
});
