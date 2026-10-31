// Focus Partner: she works next to you on a task you name (body doubling on the desktop).
//
// The rules follow three studies. An AI body double raised task efficiency as much as a human one
// and was liked for not judging (Ara et al., arXiv 2509.12153). Developers with ADHD asked for
// periodic, private, non-intrusive check-ins and no surveillance (Pimenova et al., arXiv
// 2609.21254). After a diversion people took 11-16 minutes to get back to their task, and a visible
// reminder of it brought them back sooner (Iqbal & Horvitz, CHI 2007).
//
// So: the task and time stay visible above her head; she only knows the frontmost app's name, uses
// it here and nowhere else, and never says it; a drift gets one quiet aside in her own voice, at
// most every 10 minutes; coming back gets the task named as a cue.

export interface FrontApp {
  name: string;
  bundle: string;
}

export type FocusSignal =
  /** Away from the task's apps for a while: one quiet aside. */
  | { type: "drift" }
  /** Back after an aside: name the task, as a resumption cue. */
  | { type: "back" }
  /** Occasional self-talk while you both work. */
  | { type: "murmur" }
  | { type: "done" };

/** Apps used this early in a session are taken to be the task's apps. */
export const LEARN_MS = 3 * 60_000;
export const DRIFT_MS = 3 * 60_000;
export const NUDGE_COOLDOWN_MS = 10 * 60_000;
/** Staying this long in one app after an aside means it is part of the work after all. */
export const ADOPT_MS = 8 * 60_000;
const MURMUR_MIN_MS = 11 * 60_000;
const MURMUR_SPREAD_MS = 6 * 60_000;

/** Apps that are rarely the work itself; they never join the task's apps on their own. */
const LEISURE =
  /steam|discord|bilibili|哔哩|抖音|douyin|tiktok|youtube|netflix|twitch|twitter|instagram|facebook|reddit|小红书|rednote|微博|weibo|爱奇艺|iqiyi|优酷|youku|腾讯视频|game|游戏/i;
const SELF = "com.logit.mate";

export class FocusSession {
  readonly startedAt: number;
  readonly endsAt: number;
  private workApps = new Set<string>();
  private awaySince: number | null = null;
  private current: { id: string; since: number } | null = null;
  private lastNudge = -Infinity;
  private nudged = false;
  private nextMurmur: number;
  private finished = false;

  constructor(
    readonly task: string,
    readonly minutes: number,
    now: number,
    private random: () => number = Math.random,
  ) {
    this.startedAt = now;
    this.endsAt = now + minutes * 60_000;
    this.nextMurmur = now + this.murmurGap();
  }

  remainingMs(now: number): number {
    return Math.max(0, this.endsAt - now);
  }

  /** Whole minutes worked so far. */
  focusedMinutes(now: number): number {
    return Math.round((Math.min(now, this.endsAt) - this.startedAt) / 60_000);
  }

  /** Feed the frontmost app every few seconds (null between polls); returns at most one signal. */
  observe(app: FrontApp | null, now: number): FocusSignal | null {
    if (this.finished) return null;
    if (now >= this.endsAt) {
      this.finished = true;
      return { type: "done" };
    }
    if (!app || app.bundle === SELF) return null;

    const id = app.bundle || app.name;
    if (this.current?.id !== id) this.current = { id, since: now };
    const leisure = LEISURE.test(app.name) || LEISURE.test(app.bundle);
    if (now - this.startedAt < LEARN_MS && !leisure) this.workApps.add(id);

    if (this.workApps.has(id)) {
      this.awaySince = null;
      if (this.nudged) {
        this.nudged = false;
        return { type: "back" };
      }
      if (now >= this.nextMurmur) {
        this.nextMurmur = now + this.murmurGap();
        return { type: "murmur" };
      }
      return null;
    }

    this.awaySince ??= now;
    if (this.nudged && !leisure && now - this.current.since >= ADOPT_MS) {
      // Still here long after the aside: this app is part of the work. Quietly accept it.
      this.workApps.add(id);
      this.nudged = false;
      this.awaySince = null;
      return null;
    }
    if (now - this.awaySince >= DRIFT_MS && now - this.lastNudge >= NUDGE_COOLDOWN_MS) {
      this.lastNudge = now;
      this.nudged = true;
      return { type: "drift" };
    }
    return null;
  }

  private murmurGap(): number {
    return MURMUR_MIN_MS + this.random() * MURMUR_SPREAD_MS;
  }
}

/** Adds to today's focus minutes (kept in this browser profile) and returns today's total. */
export function addFocusToday(minutes: number, now = new Date()): number {
  const day = now.toDateString();
  try {
    const saved = JSON.parse(localStorage.getItem("logitmate.focus") ?? "{}") as { day?: string; minutes?: number };
    const total = (saved.day === day ? (saved.minutes ?? 0) : 0) + minutes;
    localStorage.setItem("logitmate.focus", JSON.stringify({ day, minutes: total }));
    return total;
  } catch {
    return minutes;
  }
}

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/** Her local lines (no LLM, so app use never leaves the Mac). Asides are self-talk, not orders. */
export function focusLines(zh: boolean) {
  return zh
    ? {
        started: (task: string, min: number) => `好，我陪你做「${task}」，${min} 分钟。我也开工啦～`,
        drift: () => pick(["（我先接着做我这份……你忙完就回来哦）", "（嗯？好像跑远了一点点……我在这儿等你）", "（我继续啦，等你回来～）"]),
        back: (task: string) => `欢迎回来～继续：${task}`,
        murmur: () => pick(["（嗯……这里再想想）", "（专心专心）", "（进展不错嘛）", "（摸鱼是不可能摸鱼的）"]),
        done: (task: string, min: number) => `${min} 分钟到！「${task}」辛苦啦，休息 5 分钟吧～`,
        breakOver: (task: string) => `休息结束～再来一轮「${task}」吗？点我开始`,
        stopped: (min: number) => (min > 0 ? `好，先到这里。刚才专注了 ${min} 分钟～` : "好，下次再一起专注～"),
      }
    : {
        started: (task: string, min: number) => `Okay, ${min} minutes on "${task}". I'll get to work too~`,
        drift: () => pick(["(I'll keep going on my part… come back when you're ready.)", "(Hm, wandered off a little? I'll be right here.)", "(Still working over here~)"]),
        back: (task: string) => `Welcome back~ Back to: ${task}`,
        murmur: () => pick(["(Hmm… let me think about this bit.)", "(Focus, focus.)", "(Making good progress.)", "(No slacking off here.)"]),
        done: (task: string, min: number) => `${min} minutes! Nice work on "${task}". Take a 5-minute break~`,
        breakOver: (task: string) => `Break's over~ Another round of "${task}"? Tap me to start.`,
        stopped: (min: number) => (min > 0 ? `Okay, let's stop here. That was ${min} focused minutes~` : "Okay, let's focus together another time~"),
      };
}
