// Tap reactions chosen from the model's own expressions and motions, by label.
// Works for any model; labels come from the ModelAdapter (model3 names, VTS hotkeys or file names).

import type { ProfileExpression, ProfileMotion } from "../model/types";
import type { PetModel } from "../renderer/petModel";
import { Priority } from "../renderer/priority";

const HAPPY = /爱心|脸红|＞＜|><|笑|heart|blush|smile|happy|love/i;
/** Outfit and prop toggles: not a reaction, and they would stick. */
export const NOT_A_FEELING = /体型|裙|鞋|衣|尾巴|眼镜|钢盆|帽|body|skirt|shoe|cloth|tail|glasses|hat/i;
const OPEN = /打开|开启|切换出来|出来|open/i;
const CLOSE = /关闭|切回|收回|close/i;

const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

export type Gesture = { open: ProfileMotion; close?: ProfileMotion };

export class Reactions {
  private expressionTimer = 0;
  private busy = false;
  private headPool: ProfileExpression[];
  private gestures: Gesture[];

  constructor(private model: PetModel) {
    const { expressions, motions } = model.normalized.profile;
    const feelings = expressions.filter((e) => !NOT_A_FEELING.test(e.label));
    const happy = feelings.filter((e) => HAPPY.test(e.label));
    this.headPool = happy.length ? happy : feelings;

    this.gestures = pairGestures(motions.filter((m) => m.group !== model.normalized.profile.idleGroup));
  }

  /** Expressions to show when patted, e.g. from a learned profile; empty keeps the label guess. */
  setPatPool(names: string[]): void {
    const pool = this.model.normalized.profile.expressions.filter((e) => names.includes(e.name));
    if (pool.length) this.headPool = pool;
  }

  /** `fy` is the tap height as a fraction of the window (0 = top). */
  tap(fy: number): void {
    if (fy < 0.32) this.pat();
    else this.gesture();
  }

  pat(): void {
    const e = pick(this.headPool);
    if (e) this.express(e.name, 2600);
  }

  /** Shows an expression, then returns to neutral after `ms` (0 keeps it until the next call). */
  express(name: string, ms: number): void {
    this.model.setExpression(name);
    clearTimeout(this.expressionTimer);
    if (ms > 0) this.expressionTimer = window.setTimeout(() => this.model.clearExpression(), ms);
  }

  relax(ms = 0): void {
    clearTimeout(this.expressionTimer);
    this.expressionTimer = window.setTimeout(() => this.model.clearExpression(), ms);
  }

  /** Plays a gesture out, holds it for `holdMs`, and back; a random one when none is given. */
  gesture(g: Gesture | undefined = pick(this.gestures), holdMs = 2500 + Math.random() * 3000): void {
    if (this.busy) return;
    if (!g) return this.pat();
    this.busy = true;
    const started = this.model.startMotion(g.open.group, g.open.index, Priority.Normal, () => {
      // Start the closing half outside the motion manager's update loop.
      setTimeout(() => {
        if (g.close) this.model.startMotion(g.close.group, g.close.index, Priority.Normal);
        this.busy = false;
      }, holdMs);
    });
    if (!started) this.busy = false;
  }
}

/** Pairs "X打开" with "X关闭" so a gesture plays out and back; unpaired models use every action. */
export function pairGestures(actions: ProfileMotion[]): Gesture[] {
  const opens = actions.filter((m) => OPEN.test(m.label) && !CLOSE.test(m.label));
  if (!opens.length) return actions.map((open) => ({ open }));
  return opens.map((open) => ({ open, close: actions.find((m) => m !== open && sameGesture(m.label, open.label)) }));
}

/** "狗尾巴草打开" and "狗尾巴草关闭" are the same gesture. */
function sameGesture(a: string, b: string): boolean {
  const stem = (s: string) => s.replace(OPEN, "").replace(CLOSE, "").replace(/[切换默认手回]/g, "").trim();
  return CLOSE.test(a) && stem(a) !== "" && stem(a) === stem(b);
}
