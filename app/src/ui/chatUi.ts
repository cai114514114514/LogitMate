// Speech bubble and input box above the character's head.

const READ_MS_PER_CHAR = 90;
const MIN_SHOW_MS = 5000;
const INPUT_IDLE_MS = 90_000;

export class ChatUI {
  private bubble = document.getElementById("bubble") as HTMLDivElement;
  private text = document.getElementById("bubble-text") as HTMLSpanElement;
  private form = document.getElementById("ask") as HTMLFormElement;
  private input = document.getElementById("ask-input") as HTMLInputElement;
  private hideTimer = 0;
  private inputTimer = 0;
  private bubbleAction: (() => void) | null = null;

  /** Called with what the user typed. */
  onSubmit: (text: string) => void = () => {};
  /** Called when the input wants keyboard focus (the window must become key first). */
  onWantFocus: () => Promise<void> = async () => {};

  constructor() {
    this.bubble.addEventListener("click", () => {
      const action = this.bubbleAction;
      if (!action) return;
      this.bubbleAction = null;
      this.bubble.classList.remove("actionable");
      this.bubble.hidden = true;
      action();
    });
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.input.value = "";
      this.armInputTimer();
      this.onSubmit(text);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeInput();
      else this.armInputTimer();
    });
  }

  get inputOpen(): boolean {
    return !this.form.hidden;
  }

  async openInput(): Promise<void> {
    this.form.hidden = false;
    await this.onWantFocus();
    this.input.focus();
    this.armInputTimer();
  }

  closeInput(): void {
    this.form.hidden = true;
    this.input.blur();
    clearTimeout(this.inputTimer);
  }

  /**
   * Shows (or updates) the bubble; `streaming` keeps it open until `done()` is called.
   * `onClick` makes the bubble clickable until it hides or another line replaces it.
   */
  say(text: string, streaming = false, onClick?: () => void): void {
    clearTimeout(this.hideTimer);
    if (onClick !== undefined || !streaming) this.bubbleAction = onClick ?? null;
    this.bubble.classList.toggle("actionable", !!this.bubbleAction);
    this.bubble.classList.toggle("thinking", text === "");
    this.text.textContent = text || "…";
    this.bubble.hidden = false;
    this.bubble.scrollTop = this.bubble.scrollHeight;
    if (!streaming) this.done();
  }

  /** Starts the countdown to hide the bubble, longer for longer text. */
  done(): void {
    clearTimeout(this.hideTimer);
    const ms = Math.max(MIN_SHOW_MS, (this.text.textContent?.length ?? 0) * READ_MS_PER_CHAR);
    this.hideTimer = window.setTimeout(() => {
      this.bubble.hidden = true;
      this.bubbleAction = null;
    }, ms);
  }

  private armInputTimer(): void {
    clearTimeout(this.inputTimer);
    this.inputTimer = window.setTimeout(() => this.closeInput(), INPUT_IDLE_MS);
  }
}
