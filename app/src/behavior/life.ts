// Life: the procedural layer that keeps her moving whatever the model ships with.
//
// Each frame it decides where she looks (eyes jump in saccades and the head follows part of the
// way), adds small head and body drift, moves her mouth while her words appear, plays procedural
// gestures, and runs idle life: looking around, tilting her head, stretching, yawning, dozing off
// when nobody is around. It also reads the cursor: stroking her head is a pat, shaking the cursor
// at her makes her dizzy. Everything is offsets on standard parameters (see gestures.ts), so the
// logic here never touches the model and is unit-tested with a fake clock.

import { GESTURES, sampleTrack, type GestureName, type ProceduralGesture } from "./gestures";

export interface PointerState {
  /** Cursor relative to her face, -1..1 on each axis (y up), saturating far away. */
  x: number;
  y: number;
  /** Cursor in fractions of the model canvas (0..1 inside it, y down). */
  fx: number;
  fy: number;
  /** Milliseconds since the cursor last moved anywhere on screen. */
  stillMs: number;
  /** Cursor near her (within about a body length). */
  near: boolean;
  /** Cursor over a model pixel. */
  over: boolean;
}

export interface LifeFrame {
  /** Where the head turns (CubismLook target, -1..1). */
  look: { x: number; y: number };
  /** Where the eyes point; they lead the head. */
  gaze: { x: number; y: number };
  /** Offsets added to parameters this frame. */
  offsets: Record<string, number>;
  /** Multiplies eye openness after blinking, 0 (shut) .. 1. */
  eyeOpen: number;
}

export type LifeEvent =
  | { type: "petted" | "dizzy" | "dozed" | "woke" }
  /** Time for one of the model's own hand poses, held for about `ms`. */
  | { type: "hands"; ms: number };

type Random = () => number;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Moves `v` toward `target` with time constant `tau` seconds. */
const ease = (v: number, target: number, dt: number, tau: number) => v + (target - v) * (1 - Math.exp(-dt / tau));
/** Smooth wandering in -1..1 from incommensurate sines (cheap and seamless). */
const drift = (t: number, a: number, b: number, phase: number) => (Math.sin(t * a + phase) + 0.6 * Math.sin(t * b + phase * 2.3)) / 1.6;

// ---------------------------------------------------------------- gaze

type GazeMode = "cursor" | "idle" | "around" | "talk" | "think" | "work" | "doze";

export class Gaze {
  eye = { x: 0, y: 0 };
  head = { x: 0, y: 0 };
  private next = 0;
  private mode: GazeMode = "idle";
  private side = 1;
  private readingStep = 0;
  private modeSince = 0;
  private nextGlance = 0;

  constructor(private random: Random) {}

  update(t: number, mode: GazeMode, cursor: { x: number; y: number }): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.modeSince = t;
      this.next = t;
      this.side = this.random() < 0.5 ? -1 : 1;
      this.readingStep = 0;
      this.nextGlance = t + 20 + this.random() * 20;
    }
    if (mode === "cursor") {
      this.eye = { ...cursor };
      this.head = { ...cursor };
      return;
    }
    if (mode === "doze") {
      this.eye = { x: 0, y: -0.5 };
      this.head = { x: 0, y: -0.5 };
      return;
    }
    if (t < this.next) return;
    const r = this.random;
    const jitter = (s: number) => (r() - 0.5) * 2 * s;
    let headShare = 0.55;
    let hold: number;
    switch (mode) {
      case "idle":
        // Calm: long looks at the user, short glances away, and the head mostly stays put.
        headShare = 0.3;
        if (r() < 0.55) {
          this.eye = { x: jitter(0.08), y: 0.05 + jitter(0.06) };
          hold = 2.5 + r() * 3.5;
        } else {
          const angle = r() * Math.PI * 2;
          const mag = Math.min(0.75, 0.2 - Math.log(1 - r() * 0.95) * 0.2);
          this.eye = { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag * 0.6 - 0.05 };
          hold = 1 + r() * 1.5;
        }
        break;
      case "around": {
        const angle = r() * Math.PI * 2;
        const mag = 0.6 + r() * 0.3;
        this.eye = { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag * 0.5 };
        headShare = 0.8;
        hold = 0.5 + r() * 0.4;
        break;
      }
      case "talk":
        if (t - this.modeSince < 0.9 && r() < 0.6) {
          // Speakers often glance away as they start an utterance.
          this.eye = { x: this.side * 0.35, y: 0.3 + jitter(0.1) };
          hold = 0.6 + r() * 0.4;
        } else if (r() < 0.15) {
          this.eye = { x: jitter(0.5), y: jitter(0.25) };
          hold = 0.5 + r() * 0.4;
        } else {
          this.eye = { x: jitter(0.07), y: 0.05 + jitter(0.05) };
          hold = 1.5 + r() * 1.5;
        }
        break;
      case "think":
        this.eye = { x: this.side * 0.5 + jitter(0.08), y: 0.5 + jitter(0.06) };
        headShare = 0.6;
        hold = 0.6 + r() * 0.9;
        break;
      case "work":
        if (t >= this.nextGlance) {
          // A glance at the user now and then, then back to work.
          this.eye = { x: jitter(0.06), y: 0.05 };
          this.nextGlance = t + 20 + r() * 20;
          headShare = 0.5;
          hold = 1.2 + r() * 0.8;
        } else {
          // Reading: small steps left to right, then back to the start of the line.
          const steps = 5;
          const k = this.readingStep++ % (steps + 1);
          this.eye = { x: k === steps ? -0.3 : -0.3 + (0.6 * k) / (steps - 1), y: -0.45 + jitter(0.03) };
          headShare = 0.3;
          hold = k === steps ? 0.5 : 0.25 + r() * 0.25;
        }
        break;
      default:
        hold = 1;
    }
    this.head = { x: this.eye.x * headShare, y: this.eye.y * headShare };
    this.next = t + hold;
  }
}

// ---------------------------------------------------------------- talking mouth

interface Beat {
  kind: "syllable" | "pause";
  dur: number;
  amp: number;
  vowel: string;
  /** Last beat of a sentence: a small nod. */
  end?: boolean;
  /** Stressed syllable: a hand beat. */
  stress?: boolean;
}

const VOWELS = ["ParamA", "ParamI", "ParamU", "ParamE", "ParamO"];
const VOWEL_WEIGHTS = [0.32, 0.18, 0.14, 0.2, 0.16];
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const SHORT_PAUSE = /[，,、;；:：]/;
const LONG_PAUSE = /[。！？!?….\n]/;
/** Syllables per second when speaking; faster when lots of text is waiting. */
const SPEECH_RATE = 6.5;

/** Moves the mouth as her words appear, about one syllable per CJK character (no audio). */
export class Talker {
  private queue: Beat[] = [];
  private beat: Beat | null = null;
  private phase = 0;
  private latin = 0;
  private sincePause = 0;

  constructor(private random: Random) {}

  get talking(): boolean {
    return !!this.beat || this.queue.length > 0;
  }

  feed(text: string, quiet = false): void {
    const amp = () => (quiet ? 0.3 : 0.55 + this.random() * 0.45);
    for (const ch of text) {
      if (CJK.test(ch)) this.push({ kind: "syllable", dur: 1, amp: amp(), vowel: this.vowel() });
      else if (/[a-z0-9]/i.test(ch) && ++this.latin % 3 === 0) this.push({ kind: "syllable", dur: 1, amp: amp(), vowel: this.vowel() });
      else if (SHORT_PAUSE.test(ch)) this.push({ kind: "pause", dur: 0.16, amp: 0, vowel: "" });
      else if (LONG_PAUSE.test(ch)) {
        const last = this.queue[this.queue.length - 1];
        if (last?.kind === "syllable") last.end = true;
        this.push({ kind: "pause", dur: 0.32, amp: 0, vowel: "" });
      }
    }
    // A reply streams faster than anyone speaks; never lag far behind the bubble.
    if (this.queue.length > 90) this.queue.splice(0, this.queue.length - 90);
  }

  stop(): void {
    this.queue = [];
    this.beat = null;
  }

  /** Mouth openness 0..1, vowel shape weights, a small head bob, and whether a sentence just ended. */
  /** Seconds of speech still queued. */
  get remaining(): number {
    return this.queue.reduce((s, b) => s + (b.kind === "syllable" ? b.dur / SPEECH_RATE : b.dur), 0);
  }

  update(dt: number): { open: number; vowels: Record<string, number>; bob: number; sentenceEnd: boolean; stress: boolean } {
    const out = { open: 0, vowels: {} as Record<string, number>, bob: 0, sentenceEnd: false, stress: false };
    const rate = SPEECH_RATE * (1 + Math.max(0, this.queue.length - 20) / 30);
    let left = dt;
    while (left > 0) {
      if (!this.beat) {
        this.beat = this.queue.shift() ?? null;
        this.phase = 0;
        if (!this.beat) return out;
        if (this.beat.stress) out.stress = true;
      }
      const length = this.beat.kind === "syllable" ? this.beat.dur / rate : this.beat.dur;
      const step = Math.min(left, (1 - this.phase) * length);
      this.phase += step / length;
      left -= step;
      if (this.phase >= 1 - 1e-9) {
        if (this.beat.end) out.sentenceEnd = true;
        this.beat = null;
      }
    }
    const b = this.beat;
    if (b?.kind === "syllable") {
      const shape = Math.pow(Math.sin(Math.PI * this.phase), 0.7) * b.amp;
      out.open = shape;
      out.vowels[b.vowel] = shape;
      out.bob = -shape * 1.6;
    }
    return out;
  }

  private push(b: Beat): void {
    if (b.kind === "pause") this.sincePause = 0;
    else b.stress = this.sincePause++ % 4 === 0;
    this.queue.push(b);
  }

  private vowel(): string {
    let r = this.random();
    for (let i = 0; i < VOWELS.length; i++) {
      r -= VOWEL_WEIGHTS[i];
      if (r <= 0) return VOWELS[i];
    }
    return VOWELS[0];
  }
}

// ---------------------------------------------------------------- reading the cursor

const PET_WINDOW_S = 1.4;
const SHAKE_WINDOW_S = 1.0;
const DIZZY_COOLDOWN_S = 8;

/** Turns cursor movement into gestures: stroking her head, shaking the cursor at her. */
export class PointerSense {
  private lastFx: number | null = null;
  private dir = 0;
  private headTurns: number[] = [];
  private shakeTurns: number[] = [];
  private petUntil = 0;
  private lastDizzy = -Infinity;

  feed(p: PointerState, t: number, dt: number): { petting: boolean; startedPetting: boolean; dizzy: boolean } {
    const wasPetting = t < this.petUntil;
    let dizzy = false;
    if (this.lastFx !== null && dt > 0) {
      const dx = p.fx - this.lastFx;
      if (Math.abs(dx) > 0.004) {
        const dir = Math.sign(dx);
        if (this.dir !== 0 && dir !== this.dir) {
          const onHead = p.fy > -0.02 && p.fy < 0.3 && Math.abs(p.fx - 0.5) < 0.22;
          const around = p.fy > -0.3 && p.fy < 1 && p.fx > -0.3 && p.fx < 1.3;
          if (onHead) this.headTurns.push(t);
          if (around && Math.abs(dx) / dt > 1.5) this.shakeTurns.push(t);
        }
        this.dir = dir;
      }
    }
    this.lastFx = p.fx;
    this.headTurns = this.headTurns.filter((x) => t - x < PET_WINDOW_S);
    this.shakeTurns = this.shakeTurns.filter((x) => t - x < SHAKE_WINDOW_S);
    if (this.headTurns.length >= 2) this.petUntil = t + 1;
    if (this.shakeTurns.length >= 6 && t - this.lastDizzy > DIZZY_COOLDOWN_S) {
      this.lastDizzy = t;
      this.shakeTurns = [];
      dizzy = true;
    }
    const petting = t < this.petUntil;
    return { petting, startedPetting: petting && !wasPetting, dizzy };
  }
}

// ---------------------------------------------------------------- the whole layer

/** Cursor movement this recent counts as someone being there. */
const CURSOR_ACTIVE_MS = 2500;
const DOZE_AFTER_S = 8 * 60;
const DOZE_AFTER_TIRED_S = 3 * 60;

interface Playing {
  gesture: ProceduralGesture;
  start: number;
  amount: number;
}

export class Life {
  /** 0..1, from the time of day (Mood.energy). */
  energy = 1;
  /** -1..1 (Mood.state.mood). */
  mood = 0.2;
  /** In a focus session: she looks down at her own work. */
  working = false;
  /** Waiting for a reply, or a coding agent is working: she looks up, thinking. */
  thinking = false;
  /** How many hand poses the model has (its own motions); 0 means procedural arms only. */
  handPoses = 0;
  /** Mouth from real speech audio this frame (TTS); overrides the text-paced mouth. */
  voice: { open: number; vowel: string } | null = null;
  /** Speech audio is playing or queued. */
  voiceBusy = false;
  onEvent: (e: LifeEvent) => void = () => {};

  private t = 0;
  private playing: Playing[] = [];
  private gaze: Gaze;
  private talker: Talker;
  private sense = new PointerSense();
  private lastInteraction = 0;
  private nextIdle: number;
  private aroundUntil = 0;
  private dozing = false;
  private dozeLevel = 0;
  private nextJolt = 0;
  private smile = 0;
  private petLevel = 0;
  private petTilt = 0;
  private voiceOpen = 0;
  // Reused every frame: she runs all day, so the frame loop makes no garbage of its own.
  private offsets: Record<string, number> = {};
  private frame: LifeFrame = { look: { x: 0, y: 0 }, gaze: { x: 0, y: 0 }, offsets: this.offsets, eyeOpen: 1 };
  private glanceUntil = 0;
  private glanceAt = { x: 0, y: 0 };
  private shift = 0;
  private shiftTarget = 0;
  private nextShift = 6;
  private lastBeat = 0;
  private beatSide = 1;

  constructor(private random: Random = Math.random) {
    this.gaze = new Gaze(random);
    this.talker = new Talker(random);
    this.nextIdle = 12 + random() * 10;
  }

  get talking(): boolean {
    return this.talker.talking || this.voiceBusy;
  }

  get asleep(): boolean {
    return this.dozing;
  }

  /** A gesture, petting or a look-around is playing: worth full frame rate. */
  get animating(): boolean {
    return this.playing.length > 0 || this.petLevel > 0.05 || this.t < this.aroundUntil || this.t < this.glanceUntil;
  }

  play(name: GestureName, amount = 1): void {
    this.playing.push({ gesture: GESTURES[name], start: this.t, amount });
  }

  /**
   * Text she is saying right now (appended to what she already said). With `voiced`, real audio
   * moves her mouth (see `voice`), so the text only drives gestures.
   */
  speak(text: string, quiet = false, voiced = false): void {
    const starting = !this.talking;
    if (!voiced) this.talker.feed(text, quiet);
    this.noteInteraction();
    // Now and then she talks with her hands, using one of the model's own poses.
    if (starting && !quiet && this.handPoses > 0 && this.random() < 0.35) {
      const seconds = voiced ? text.length / 5 : this.talker.remaining;
      this.onEvent({ type: "hands", ms: Math.max(2500, Math.min(8000, seconds * 1000 + 1500)) });
    }
  }

  /** Looks toward a point (-1..1 from her face) for a while, e.g. at the screen she was asked to see. */
  glance(x: number, y: number, seconds: number): void {
    this.glanceAt = { x, y };
    this.glanceUntil = this.t + seconds;
  }

  stopSpeaking(): void {
    this.talker.stop();
  }

  /** Chat, taps and the like: someone is here. */
  noteInteraction(): void {
    this.lastInteraction = this.t;
    if (this.dozing) this.wake(false);
  }

  update(dt: number, p: PointerState): LifeFrame {
    this.t += dt;
    const t = this.t;
    const r = this.random;
    const offsets = this.offsets;
    for (const id in offsets) offsets[id] = 0;
    const add = (id: string, v: number) => (offsets[id] = (offsets[id] ?? 0) + v);
    const cursorActive = p.stillMs < CURSOR_ACTIVE_MS;

    // Cursor gestures.
    const sense = this.sense.feed(p, t, dt);
    if (sense.startedPetting) this.onEvent({ type: "petted" });
    if (sense.dizzy) {
      this.play("dizzy");
      this.onEvent({ type: "dizzy" });
    }
    if (sense.petting || cursorActive) this.lastInteraction = Math.max(this.lastInteraction, t - p.stillMs / 1000);

    // Dozing off when nobody has been around for a while, waking when someone is.
    const quietFor = t - this.lastInteraction;
    if (!this.dozing && !this.talking && !this.working && quietFor > (this.energy < 0.4 ? DOZE_AFTER_TIRED_S : DOZE_AFTER_S)) {
      this.dozing = true;
      this.nextJolt = t + 10 + r() * 10;
      this.onEvent({ type: "dozed" });
    } else if (this.dozing && cursorActive && p.stillMs < 300) {
      this.wake(p.near);
    }
    this.dozeLevel = ease(this.dozeLevel, this.dozing ? 1 : 0, dt, this.dozing ? 2.5 : 0.25);

    // Idle life.
    const busy = this.talking || this.playing.length > 0 || this.dozing || sense.petting;
    if (busy || cursorActive) this.nextIdle = Math.max(this.nextIdle, t + 4);
    if (!busy && t >= this.nextIdle) {
      this.idleAct();
      this.nextIdle = t + (this.working ? 40 : 14) + r() * (this.working ? 40 : 26) * (1.4 - this.energy * 0.6);
    }
    if (this.dozing && this.dozeLevel > 0.9 && t >= this.nextJolt) {
      this.play("jolt", 0.6);
      this.nextJolt = t + 10 + r() * 12;
    }

    // Gaze.
    const glancing = t < this.glanceUntil;
    const mode: GazeMode = this.dozing
      ? "doze"
      : glancing || sense.petting || p.over || (cursorActive && p.near)
        ? "cursor"
        : this.talking
          ? "talk"
          : this.thinking
            ? "think"
            : t < this.aroundUntil
              ? "around"
              : this.working
                ? "work"
                : "idle";
    this.gaze.update(t, mode, glancing ? this.glanceAt : { x: p.x, y: p.y });

    // Small, never-repeating head and body drift; livelier with more energy.
    const liveliness = 0.6 + 0.6 * this.energy;
    add("ParamAngleX", drift(t, 0.31, 0.53, 0.0) * 2 * liveliness);
    add("ParamAngleY", drift(t, 0.27, 0.71, 1.7) * 1.5 * liveliness);
    add("ParamAngleZ", drift(t, 0.23, 0.61, 3.1) * 1.5 * liveliness);
    add("ParamBodyAngleX", drift(t, 0.17, 0.43, 4.2) * 1.5 * liveliness);
    add("ArmL", drift(t, 0.21, 0.47, 6.1) * 0.08);
    add("ArmR", drift(t, 0.19, 0.53, 7.7) * 0.08);

    // Shifting her weight from one side to the other now and then, as people do standing still.
    if (t >= this.nextShift) {
      this.shiftTarget = this.dozing || this.working ? 0 : (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.6);
      this.nextShift = t + 8 + r() * 14;
    }
    this.shift = ease(this.shift, this.shiftTarget, dt, 1.4);
    add("ParamBodyAngleZ", this.shift * 3);
    add("ParamAngleZ", -this.shift * 2);
    add("ArmL", this.shift * 0.1);
    add("ArmR", -this.shift * 0.1);

    // Dozing: head droops, body slumps.
    if (this.dozeLevel > 0.01) {
      add("ParamAngleY", -12 * this.dozeLevel);
      add("ParamAngleZ", 8 * this.dozeLevel);
      add("ParamBodyAngleY", -4 * this.dozeLevel);
    }

    // Petting: eyes close happily and the head leans into the stroke.
    this.petLevel = ease(this.petLevel, sense.petting ? 1 : 0, dt, sense.petting ? 0.25 : 0.5);
    this.petTilt = ease(this.petTilt, sense.petting ? (p.fx - 0.5) * -40 : 0, dt, 0.3);
    if (this.petLevel > 0.01) {
      add("ParamAngleZ", this.petTilt * this.petLevel);
      add("ParamAngleY", -4 * this.petLevel);
    }

    // Face: a mood-coloured resting smile, brighter when the cursor is on her or she is petted.
    const smileTarget = clamp(this.mood * 0.35 + (p.over ? 0.3 : 0) + this.petLevel * 0.5, -0.4, 1);
    this.smile = ease(this.smile, smileTarget, dt, 0.4);
    add("ParamMouthForm", this.smile);
    for (const id of ["ParamEyeLSmile", "ParamEyeRSmile", "EyeSmile"]) add(id, Math.max(0, this.smile) * 0.3 + this.petLevel * 0.6);
    add("ParamBrowLY", this.mood * 0.15);
    add("ParamBrowRY", this.mood * 0.15);

    // Talking.
    const mouth = this.talker.update(dt);
    if (this.voice) {
      // Real speech: loudness opens the mouth; a stress beat when it opens wide after a dip.
      const was = this.voiceOpen;
      this.voiceOpen = ease(this.voiceOpen, this.voice.open, dt, 0.04);
      mouth.open = this.voiceOpen;
      mouth.vowels = { [this.voice.vowel]: this.voiceOpen };
      mouth.bob = -this.voiceOpen * 1.6;
      mouth.stress = was < 0.25 && this.voiceOpen >= 0.25;
    } else {
      this.voiceOpen = 0;
    }
    if (mouth.open > 0) {
      add("ParamMouthOpenY", mouth.open);
      for (const [id, v] of Object.entries(mouth.vowels)) add(id, v);
      add("ParamAngleY", mouth.bob);
    }
    if (mouth.sentenceEnd && r() < 0.6) this.play("nod", 0.45);
    if (mouth.stress && t - this.lastBeat > 0.7 && r() < 0.55) {
      this.beatSide = r() < 0.7 ? this.beatSide : -this.beatSide;
      this.play(this.beatSide > 0 ? "beatR" : "beatL", 0.6 + r() * 0.4);
      this.lastBeat = t;
    }

    // Gestures.
    let gestureClose = 0;
    this.playing = this.playing.filter((pl) => t - pl.start < pl.gesture.duration);
    for (const pl of this.playing) {
      const tracks = pl.gesture.tracks;
      for (const id in tracks) {
        const v = sampleTrack(tracks[id], t - pl.start) * pl.amount;
        if (id === "EyeClose") gestureClose = Math.max(gestureClose, v);
        else add(id, v);
      }
    }

    const frame = this.frame;
    frame.look = this.gaze.head;
    frame.gaze = this.gaze.eye;
    frame.eyeOpen = 1 - clamp(Math.max(this.dozeLevel, this.petLevel * 0.85, gestureClose), 0, 1);
    return frame;
  }

  private wake(startled: boolean): void {
    this.dozing = false;
    this.lastInteraction = this.t;
    if (startled) this.play("hop");
    this.onEvent({ type: "woke" });
  }

  private idleAct(): void {
    const r = this.random;
    const choices: [() => void, number][] = this.working
      ? [
          [() => this.play("tilt", 0.6), 2],
          [() => this.play("nod", 0.5), 2],
          [() => this.play("stretch", 0.8), 1],
        ]
      : [
          [() => (this.aroundUntil = this.t + 2.5 + r() * 1.5), 3],
          [() => this.play("tilt"), 2],
          [() => this.onEvent({ type: "hands", ms: 4000 + r() * 8000 }), this.handPoses > 0 ? 2.5 : 0],
          [() => this.play("wiggle", 0.7), this.mood > 0.1 ? 2 : 0.5],
          [() => this.hum(), this.mood > 0.15 ? 1.5 : 0.3],
          [() => this.play("stretch"), 0.8],
          [() => this.play("yawn"), this.energy < 0.45 ? 2.5 : 0.15],
          [() => this.play("sigh"), this.mood < -0.2 ? 2 : 0.2],
        ];
    let pick = r() * choices.reduce((s, [, w]) => s + w, 0);
    for (const [act, w] of choices) {
      pick -= w;
      if (pick <= 0) return act();
    }
  }

  /** Humming to herself: a gentle sway with a quiet, closed-mouth "mm mm". */
  private hum(): void {
    this.play("sway");
    this.talker.feed("嗯嗯嗯嗯嗯", true);
  }
}
