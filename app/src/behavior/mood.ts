// Emotion engine v1: a small state that gives her a personality between LLM calls.
//   mood       -1 (down) .. 1 (cheerful), drifts back to a slightly positive baseline
//   energy     0 .. 1 from the local time of day (sleepy at night)
//   affection  grows with pats and conversations, never decays
// The state feeds the system prompt and idle behaviour, and persists across launches.

export interface MoodState {
  mood: number;
  affection: number;
  /** Last time the user interacted, epoch ms. */
  lastSeen: number;
}

const STORAGE_KEY = "logitmate.mood";
const BASELINE = 0.2;
/** Mood half-life toward the baseline, in seconds. */
const HALF_LIFE = 600;

const EMOTION_NUDGE: Record<string, number> = {
  happy: 0.08,
  love: 0.1,
  shy: 0.04,
  smug: 0.03,
  surprised: 0,
  thinking: 0,
  confused: -0.02,
  nervous: -0.04,
  sad: -0.1,
  angry: -0.12,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Mood {
  state: MoodState;

  constructor(
    private storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
    private clock: () => number = Date.now,
  ) {
    this.state = this.load();
  }

  /** 0..1 from the hour: lowest around 3-5am, full during the day. */
  energy(date = new Date(this.clock())): number {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h < 6) return 0.15;
    if (h < 9) return 0.15 + ((h - 6) / 3) * 0.85;
    if (h < 22) return 1;
    return 1 - ((h - 22) / 2) * 0.7;
  }

  /** Hours since the user was last around, measured before this call updates it. */
  touch(): number {
    const away = (this.clock() - this.state.lastSeen) / 3_600_000;
    this.state.lastSeen = this.clock();
    this.save();
    return away;
  }

  onPat(): void {
    this.state.mood = clamp(this.state.mood + 0.08, -1, 1);
    this.state.affection += 1;
    this.touch();
  }

  onChat(): void {
    this.state.mood = clamp(this.state.mood + 0.03, -1, 1);
    this.state.affection += 0.5;
    this.touch();
  }

  onEmotion(emotion: string): void {
    this.state.mood = clamp(this.state.mood + (EMOTION_NUDGE[emotion] ?? 0), -1, 1);
    this.save();
  }

  /** Lets the mood drift back toward the baseline over `seconds`. */
  tick(seconds: number): void {
    const k = Math.pow(0.5, seconds / HALF_LIFE);
    this.state.mood = BASELINE + (this.state.mood - BASELINE) * k;
    this.save();
  }

  reset(): void {
    this.state = { mood: BASELINE, affection: 0, lastSeen: this.clock() };
    this.save();
  }

  /** One line for the system prompt. */
  describe(): string {
    const { mood, affection } = this.state;
    const feeling = mood > 0.5 ? "cheerful" : mood > 0.1 ? "content" : mood > -0.3 ? "a bit flat" : "down";
    const e = this.energy();
    const energy = e < 0.3 ? "sleepy" : e < 0.7 ? "waking up / winding down" : "lively";
    const bond =
      affection < 5 ? "you have only just met" : affection < 30 ? "you are getting friendly" : affection < 100 ? "you are close friends" : "you are very close";
    return `You feel ${feeling} and ${energy}; ${bond}.`;
  }

  private load(): MoodState {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<MoodState>;
        if (typeof s.mood === "number" && typeof s.affection === "number") {
          return { mood: s.mood, affection: s.affection, lastSeen: s.lastSeen ?? this.clock() };
        }
      }
    } catch {
      // Unreadable storage: start fresh.
    }
    return { mood: BASELINE, affection: 0, lastSeen: this.clock() };
  }

  private save(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Storage full or unavailable: keep running with in-memory state.
    }
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
