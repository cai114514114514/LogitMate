// Speaks her lines with MiMo TTS: sentences are synthesized while the reply still streams (one
// ahead of playback), played in order, and measured so her mouth follows the actual voice.

import { invoke } from "@tauri-apps/api/core";
import { splitSentences, styled } from "./sentences";

/** Sentences synthesized ahead of the one playing. */
const LOOKAHEAD = 2;
const VOWELS = ["ParamU", "ParamO", "ParamA", "ParamE", "ParamI"];

export interface Mouth {
  open: number;
  vowel: string;
}

export class Speaker {
  enabled = false;
  /** Her current emotion, used as the style of the next sentences. */
  emotion: string | null = null;
  onError: (e: unknown) => void = () => {};

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buffer = "";
  private quiet = false;
  private queue: Promise<AudioBuffer | null>[] = [];
  private waiting: { text: string; quiet: boolean }[] = [];
  private source: AudioBufferSourceNode | null = null;
  private generation = 0;
  private playing = false;
  private time = new Float32Array(1024);
  private freq = new Float32Array(512);

  constructor(
    private voiceKey: string,
    private zh: boolean,
  ) {}

  /** True while there is anything left to say. */
  get busy(): boolean {
    return this.playing || this.queue.length > 0 || this.waiting.length > 0 || this.buffer.trim() !== "";
  }

  /** New text of the current line; `fresh` starts a new line (the old one is cut off). */
  feed(text: string, quiet: boolean, fresh: boolean): void {
    if (!this.enabled) return;
    if (fresh) this.stop();
    this.quiet = quiet;
    this.buffer += text;
    const { sentences, rest } = splitSentences(this.buffer);
    this.buffer = rest;
    for (const s of sentences) this.enqueue(s);
  }

  /** The line is complete: speak whatever is left. */
  flush(): void {
    if (!this.enabled) return;
    const { sentences } = splitSentences(this.buffer, true);
    this.buffer = "";
    for (const s of sentences) this.enqueue(s);
  }

  stop(): void {
    this.generation++;
    this.buffer = "";
    this.queue = [];
    this.waiting = [];
    try {
      this.source?.stop();
    } catch {
      // already stopped
    }
    this.source = null;
    this.playing = false;
  }

  /** Plays a base64 WAV right away (voice samples); resolves when it ends. */
  async playWav(base64: string): Promise<void> {
    this.stop();
    const audio = await this.decode(base64);
    if (audio) await this.play(audio, this.generation);
    this.playing = false;
  }

  /** Mouth shape from the sound playing now: loudness opens it, brightness picks the vowel. */
  mouth(): Mouth | null {
    if (!this.playing || !this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (const v of this.time) sum += v * v;
    const rms = Math.sqrt(sum / this.time.length);
    const open = Math.min(1, Math.max(0, (rms - 0.01) * 7));
    if (open <= 0) return { open: 0, vowel: "ParamA" };
    this.analyser.getFloatFrequencyData(this.freq);
    const binHz = this.ctx!.sampleRate / 2 / this.freq.length;
    let weighted = 0;
    let total = 0;
    for (let i = 2; i < this.freq.length; i++) {
      const hz = i * binHz;
      if (hz > 4000) break;
      const p = Math.pow(10, this.freq[i] / 20);
      weighted += p * hz;
      total += p;
    }
    // Dark vowels (u, o) have energy low in the spectrum, bright ones (e, i) high.
    const centroid = total > 0 ? weighted / total : 1000;
    const k = Math.min(VOWELS.length - 1, Math.max(0, Math.floor((centroid - 500) / 400)));
    return { open, vowel: VOWELS[k] };
  }

  private enqueue(sentence: string): void {
    this.waiting.push({ text: styled(sentence, this.emotion, this.quiet), quiet: this.quiet });
    this.pump();
  }

  /** Keeps up to LOOKAHEAD syntheses in flight and starts playback when idle. */
  private pump(): void {
    const gen = this.generation;
    while (this.queue.length < LOOKAHEAD && this.waiting.length) {
      const { text } = this.waiting.shift()!;
      this.queue.push(
        invoke<string>("tts_speak", { key: this.voiceKey, text, direction: "", zh: this.zh })
          .then((b64) => (gen === this.generation ? this.decode(b64) : null))
          .catch((e) => {
            if (gen === this.generation) this.onError(e);
            return null;
          }),
      );
    }
    if (!this.playing && this.queue.length) void this.next(gen);
  }

  private async next(gen: number): Promise<void> {
    const pending = this.queue[0];
    if (!pending) return;
    this.playing = true;
    const audio = await pending;
    if (gen !== this.generation) return;
    this.queue.shift();
    if (audio) await this.play(audio, gen);
    if (gen !== this.generation) return;
    this.playing = false;
    this.pump();
  }

  private play(audio: AudioBuffer, gen: number): Promise<void> {
    const ctx = this.context();
    return new Promise((done) => {
      if (gen !== this.generation) return done();
      const source = ctx.createBufferSource();
      source.buffer = audio;
      source.connect(this.analyser!);
      source.onended = () => done();
      this.source = source;
      this.playing = true;
      source.start();
    });
  }

  private async decode(base64: string): Promise<AudioBuffer | null> {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    try {
      return await this.context().decodeAudioData(bytes.buffer as ArrayBuffer);
    } catch (e) {
      this.onError(e);
      return null;
    }
  }

  private context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.3;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }
}
