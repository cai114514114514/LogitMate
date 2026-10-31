// Desktop presence: she lives in the desktop, not in a fixed box. Dropped onto a window's top
// edge she stands on it and rides along when it moves (and falls when it goes away); pushed past
// the screen edge she peeks in from behind it; during calls and full-screen apps she steps aside.
// Pure geometry here; main.ts moves the window. All rectangles are in points, y down.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowInfo extends Rect {
  id: number;
  owner: string;
  pid: number;
}

/** Her feet must be this close to a window's top edge when dropped to land on it. */
export const PERCH_SNAP = 48;
/** Feet this far inside a window's sides; she doesn't stand on the very corner. */
const EDGE_MARGIN = 24;
/** Pushed this far past the screen edge (share of her width), she peeks instead of bouncing back. */
export const PEEK_PAST = 0.35;
/** While peeking, this share of her width stays on screen. */
export const PEEK_SHOWN = 0.55;

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;

/**
 * The window she lands on when dropped with her feet at `feet`: the frontmost window whose top
 * edge is right under them, not covered there by a window in front of it, and low enough that
 * she fits above it (`minEdgeY`: the screen top plus her height).
 */
export function findPerch(feet: { x: number; y: number }, windows: WindowInfo[], minEdgeY = -Infinity): WindowInfo | null {
  for (const [i, w] of windows.entries()) {
    if (feet.x < w.x + EDGE_MARGIN || feet.x > w.x + w.width - EDGE_MARGIN) continue;
    if (Math.abs(feet.y - w.y) > PERCH_SNAP || w.y < minEdgeY) continue;
    const covered = windows.slice(0, i).some((front) => inside(front, feet.x, w.y - 2));
    if (!covered) return w;
  }
  return null;
}

export interface Perch {
  id: number;
  /** Her feet's horizontal offset from the window's left edge. */
  dx: number;
}

/**
 * Where her feet go while standing on a window: on its top edge at the same offset, kept within
 * its width if it shrank. Null when the window is gone (closed, minimized, another Space).
 */
export function perchFeet(perch: Perch, windows: WindowInfo[]): { x: number; y: number } | null {
  const w = windows.find((win) => win.id === perch.id);
  if (!w) return null;
  const x = Math.min(Math.max(w.x + perch.dx, w.x + EDGE_MARGIN), w.x + w.width - EDGE_MARGIN);
  return { x, y: w.y };
}

/** Tucked into the bottom edge, this share of her (model) height shows: head and shoulders. */
export const TUCK_SHOWN = 0.4;

/**
 * Where her window goes after a drag: fully on screen; peeking in from behind the left or right
 * edge when pushed far enough past it (`side` -1 or 1); or tucked into the bottom edge with only
 * her head and shoulders showing (`tucked`). `talk` is the room for the bubble above her model.
 */
export function settleAtEdge(box: Rect, screen: Rect, talk = 0): { x: number; y: number; side: -1 | 0 | 1; tucked: boolean } {
  const model = box.height - talk;
  const bottom = screen.y + screen.height;
  const pastBottom = box.y + box.height - bottom;
  const tucked = pastBottom > model * PEEK_PAST;
  const y = tucked ? bottom - talk - model * TUCK_SHOWN : Math.min(Math.max(box.y, screen.y), bottom - box.height);
  const pastLeft = screen.x - box.x;
  const pastRight = box.x + box.width - (screen.x + screen.width);
  if (pastLeft > box.width * PEEK_PAST) return { x: screen.x - box.width * (1 - PEEK_SHOWN), y, side: -1, tucked };
  if (pastRight > box.width * PEEK_PAST) return { x: screen.x + screen.width - box.width * PEEK_SHOWN, y, side: 1, tucked };
  return { x: Math.min(Math.max(box.x, screen.x), screen.x + screen.width - box.width), y, side: 0, tucked };
}

/** A window covering a whole display: a full-screen video, game or presentation. */
export function isFullScreen(front: WindowInfo | undefined, screens: Rect[]): boolean {
  if (!front) return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= 2;
  return screens.some((s) => near(front.x, s.x) && near(front.y, s.y) && near(front.width, s.width) && near(front.height, s.height));
}
