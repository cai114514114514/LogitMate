import { describe, expect, it } from "vitest";
import { GESTURES, sampleGesture, sampleTrack } from "./gestures";

describe("gestures", () => {
  it("interpolates smoothly through keyframes and rests at both ends", () => {
    const track: [number, number][] = [[0, 0], [1, 10], [2, 0]];
    expect(sampleTrack(track, 0)).toBe(0);
    expect(sampleTrack(track, 0.5)).toBeCloseTo(5);
    expect(sampleTrack(track, 1)).toBe(10);
    expect(sampleTrack(track, 3)).toBe(0);
  });

  it("every gesture starts and ends at rest, within its duration", () => {
    for (const [name, g] of Object.entries(GESTURES)) {
      for (const [id, track] of Object.entries(g.tracks)) {
        expect(track[0], `${name}.${id} start`).toEqual([0, 0]);
        expect(track[track.length - 1][1], `${name}.${id} end`).toBe(0);
        expect(track[track.length - 1][0], `${name}.${id} length`).toBeLessThanOrEqual(g.duration);
      }
    }
    expect(sampleGesture(GESTURES.nod, 0.18, 0.5).ParamAngleY).toBeCloseTo(-5);
  });
});
