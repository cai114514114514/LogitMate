import { describe, expect, it } from "vitest";
import { alphaBox, diffBox, faceBox, panelBox, zoomBox, type Still } from "./stills";

/** A w×h still with opaque white rectangles painted in. */
function still(w: number, h: number, rects: [number, number, number, number][]): Still {
  const pixels = new Uint8Array(w * h * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.set([255, 255, 255, 255], (y * w + x) * 4);
  }
  return { width: w, height: h, pixels };
}

describe("stills", () => {
  const body: [number, number, number, number] = [40, 10, 60, 100];

  it("finds what is drawn and what changed", () => {
    const rest = still(100, 120, [body]);
    expect(alphaBox(rest)).toEqual({ x0: 40, y0: 10, x1: 60, y1: 100 });
    const withHat = still(100, 120, [body, [42, 2, 58, 10]]);
    expect(diffBox(rest, withHat)).toEqual({ x0: 42, y0: 2, x1: 58, y1: 10 });
    expect(diffBox(rest, still(100, 120, [body]))).toBeNull();
    // A handful of pixels is anti-aliasing noise.
    expect(diffBox(rest, still(100, 120, [body, [0, 0, 3, 3]]))).toBeNull();
  });

  it("locates the face from the eyes-and-mouth probe, or the top of the body", () => {
    const rest = still(100, 120, [body]);
    // Eyes and mouth change in a 10×10 area around (50, 25).
    const probe = still(100, 120, [[40, 10, 45, 100], [55, 10, 60, 100], [45, 10, 55, 20], [45, 30, 55, 100]]);
    const face = faceBox(rest, probe, alphaBox(rest)!);
    expect(face).toEqual({ x0: 40, y0: 15, x1: 60, y1: 35 });
    const fallback = faceBox(rest, null, alphaBox(rest)!);
    expect(fallback).toEqual({ x0: 40, y0: 10, x1: 60, y1: 30 });
  });

  it("widens the panel to take in far-away changes", () => {
    const face = { x0: 38, y0: 13, x1: 62, y1: 37 };
    expect(panelBox(face, null, 100, 120)).toBe(face);
    const shoes = { x0: 40, y0: 95, x1: 60, y1: 100 };
    const p = panelBox(face, shoes, 100, 120);
    expect(p.y0).toBe(13);
    expect(p.y1).toBeGreaterThanOrEqual(100);
    expect(p.y1).toBeLessThanOrEqual(120);
  });

  it("zooms in on small changes only", () => {
    const panel = { x0: 0, y0: 0, x1: 100, y1: 100 };
    const tear = { x0: 60, y0: 40, x1: 64, y1: 50 };
    expect(zoomBox(tear, panel, 200, 200)).toEqual({ x0: 47, y0: 30, x1: 77, y1: 60 });
    expect(zoomBox({ x0: 0, y0: 0, x1: 80, y1: 80 }, panel, 200, 200)).toBeNull();
  });
});
