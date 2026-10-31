// Still frames read back from the stage, and the pixel math that decides what to show the labeller:
// where the face is, and what an expression changed.

/** RGBA, premultiplied alpha, top row first. */
export interface Still {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Pixel rectangle, x0/y0 inclusive, x1/y1 exclusive, y down. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Fewer changed pixels than this is noise, not an expression. */
const MIN_CHANGED = 24;

export const boxWidth = (b: Box) => b.x1 - b.x0;
export const boxHeight = (b: Box) => b.y1 - b.y0;

export function union(a: Box, b: Box): Box {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

export function clip(b: Box, w: number, h: number): Box {
  return { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(w, b.x1), y1: Math.min(h, b.y1) };
}

/** Scales a box around its centre and makes it at least `minSide` on both axes. */
export function grow(b: Box, factor: number, minSide = 0): Box {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const hw = Math.max(boxWidth(b) * factor, minSide) / 2;
  const hh = Math.max(boxHeight(b) * factor, minSide) / 2;
  return { x0: Math.floor(cx - hw), y0: Math.floor(cy - hh), x1: Math.ceil(cx + hw), y1: Math.ceil(cy + hh) };
}

/** Bounds of everything drawn (alpha above `min`). */
export function alphaBox(s: Still, min = 16): Box | null {
  let x0 = s.width, y0 = s.height, x1 = -1, y1 = -1;
  for (let y = 0; y < s.height; y++) {
    const row = y * s.width * 4;
    for (let x = 0; x < s.width; x++) {
      if (s.pixels[row + x * 4 + 3] <= min) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Bounds of the pixels that differ between two stills of the same size; null when nothing visible
 * changed. Stills of the same pose render identically, so a low threshold catches faint overlays
 * such as blush.
 */
export function diffBox(a: Still, b: Still, threshold = 10): Box | null {
  let x0 = a.width, y0 = a.height, x1 = -1, y1 = -1, changed = 0;
  const pa = a.pixels;
  const pb = b.pixels;
  for (let y = 0; y < a.height; y++) {
    const row = y * a.width * 4;
    for (let x = 0; x < a.width; x++) {
      const i = row + x * 4;
      const d = Math.max(
        Math.abs(pa[i] - pb[i]),
        Math.abs(pa[i + 1] - pb[i + 1]),
        Math.abs(pa[i + 2] - pb[i + 2]),
        Math.abs(pa[i + 3] - pb[i + 3]),
      );
      if (d <= threshold) continue;
      changed++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return changed < MIN_CHANGED ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Where the face is. `probe` is the rest pose with eyes closed and mouth open: what changes spans
 * eyes to mouth, about half a head, so a square twice that size holds the head. Rigs without those
 * parameters fall back to the top of the drawn area.
 */
export function faceBox(rest: Still, probe: Still | null, body: Box): Box {
  const features = probe && diffBox(rest, probe, 24);
  if (features) {
    const side = Math.max(boxWidth(features), boxHeight(features)) * 2;
    return clip(grow(features, 1, side), rest.width, rest.height);
  }
  const side = Math.min(boxWidth(body), boxHeight(body) * 0.3);
  const cx = (body.x0 + body.x1) / 2;
  return clip({ x0: Math.floor(cx - side / 2), y0: body.y0, x1: Math.ceil(cx + side / 2), y1: Math.ceil(body.y0 + side) }, rest.width, rest.height);
}

/**
 * A close-up of a small change (tears, blush, a sweat drop), which is easy to miss at panel size;
 * null when the change already fills a good part of the panel.
 */
export function zoomBox(changed: Box, panel: Box, width: number, height: number): Box | null {
  const share = (boxWidth(changed) * boxHeight(changed)) / (boxWidth(panel) * boxHeight(panel));
  if (share > 0.25) return null;
  const minSide = Math.max(boxWidth(panel), boxHeight(panel)) * 0.3;
  return clip(grow(changed, 1.6, minSide), width, height);
}

/** What to show for one expression: the face, widened to take in whatever else it changed. */
export function panelBox(face: Box, changed: Box | null, width: number, height: number): Box {
  if (!changed) return face;
  return clip(union(face, grow(changed, 1.25, 24)), width, height);
}
