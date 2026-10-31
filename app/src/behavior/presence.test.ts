import { describe, expect, it } from "vitest";
import { findPerch, isFullScreen, perchFeet, settleAtEdge, type WindowInfo } from "./presence";

const win = (id: number, x: number, y: number, width: number, height: number): WindowInfo => ({ id, owner: "App", pid: id, x, y, width, height });

describe("presence", () => {
  const editor = win(1, 100, 300, 900, 600);
  const browser = win(2, 600, 200, 800, 700);

  it("lands on the window whose top edge is under her feet", () => {
    expect(findPerch({ x: 300, y: 320 }, [editor])?.id).toBe(1);
    expect(findPerch({ x: 300, y: 380 }, [editor])).toBeNull(); // too far below the edge
    expect(findPerch({ x: 110, y: 300 }, [editor])).toBeNull(); // on the very corner
    // No room above it for her: she would be cut off by the top of the screen.
    expect(findPerch({ x: 300, y: 320 }, [editor], 500)).toBeNull();
  });

  it("skips a top edge covered by a window in front", () => {
    // Browser (in front) covers the editor's top edge from x=600 on.
    expect(findPerch({ x: 700, y: 300 }, [browser, editor])).toBeNull();
    expect(findPerch({ x: 300, y: 300 }, [browser, editor])?.id).toBe(1);
    expect(findPerch({ x: 700, y: 210 }, [browser, editor])?.id).toBe(2);
  });

  it("rides along with the window and notices when it is gone", () => {
    const perch = { id: 1, dx: 200 };
    expect(perchFeet(perch, [win(1, 400, 500, 900, 600)])).toEqual({ x: 600, y: 500 });
    // The window shrank: she stays on it.
    expect(perchFeet(perch, [win(1, 400, 500, 150, 600)])).toEqual({ x: 526, y: 500 });
    expect(perchFeet(perch, [browser])).toBeNull();
  });

  it("peeks in from behind a screen edge when pushed far enough past it", () => {
    const screen = { x: 0, y: 25, width: 1728, height: 1092 };
    const box = (x: number, y = 300) => ({ x, y, width: 300, height: 770 });
    expect(settleAtEdge(box(-50), screen)).toEqual({ x: 0, y: 300, side: 0, tucked: false });
    expect(settleAtEdge(box(-150), screen)).toEqual({ x: -135, y: 300, side: -1, tucked: false });
    expect(settleAtEdge(box(1600), screen)).toEqual({ x: 1563, y: 300, side: 1, tucked: false });
    expect(settleAtEdge(box(500, 0), screen).y).toBe(25);
  });

  it("tucks into the bottom edge with head and shoulders showing", () => {
    const screen = { x: 0, y: 25, width: 1728, height: 1092 };
    // 770 tall: 170 for the bubble, 600 of her. Pushed 300 past the bottom (more than 35%).
    const s = settleAtEdge({ x: 500, y: 1117 - 770 + 300, width: 300, height: 770 }, screen, 170);
    expect(s.tucked).toBe(true);
    expect(s.y).toBe(1117 - 170 - 240);
    // A little past the bottom just bounces back.
    expect(settleAtEdge({ x: 500, y: 1117 - 770 + 100, width: 300, height: 770 }, screen, 170)).toMatchObject({ y: 347, tucked: false });
  });

  it("recognizes a full-screen window", () => {
    const screens = [{ x: 0, y: 0, width: 1728, height: 1117 }];
    expect(isFullScreen(win(3, 0, 0, 1728, 1117), screens)).toBe(true);
    expect(isFullScreen(editor, screens)).toBe(false);
    expect(isFullScreen(undefined, screens)).toBe(false);
  });
});
