// Focus Partner controls: a small form to name the task and pick a length, and a pill above her
// head with the time left and the task (kept in view as a reminder of what you came back for).

const LENGTHS = [25, 50, 90];

export class FocusUI {
  private form = document.getElementById("focus") as HTMLFormElement;
  private input = document.getElementById("focus-task") as HTMLInputElement;
  private chips = document.getElementById("focus-lengths") as HTMLDivElement;
  private pill = document.getElementById("focus-pill") as HTMLDivElement;
  private time = document.getElementById("focus-time") as HTMLSpanElement;
  private label = document.getElementById("focus-label") as HTMLSpanElement;
  private minutes = LENGTHS[0];

  /** Called with the task and length when the user starts a session. */
  onStart: (task: string, minutes: number) => void = () => {};
  /** Called when the user ends a session early. */
  onStop: () => void = () => {};
  /** Called when the input wants keyboard focus (the window must become key first). */
  onWantFocus: () => Promise<void> = async () => {};

  constructor(zh: boolean) {
    this.input.placeholder = zh ? "这次要专注做什么？（回车开始）" : "What will you work on? (Enter to start)";
    for (const m of LENGTHS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = zh ? `${m} 分钟` : `${m} min`;
      b.addEventListener("click", () => this.pick(m));
      this.chips.append(b);
    }
    this.pick(this.minutes);
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const task = this.input.value.trim();
      if (!task) return;
      this.close();
      this.onStart(task, this.minutes);
    });
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
    document.getElementById("focus-stop")!.addEventListener("click", () => this.onStop());
    document.getElementById("focus-stop")!.title = zh ? "结束专注" : "End focus";
  }

  async open(task = ""): Promise<void> {
    this.input.value = task;
    this.form.hidden = false;
    await this.onWantFocus();
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.form.hidden = true;
    this.input.blur();
  }

  show(task: string, remainingMs: number): void {
    this.label.textContent = task;
    this.update(remainingMs);
    this.pill.hidden = false;
  }

  update(remainingMs: number): void {
    const s = Math.ceil(remainingMs / 1000);
    this.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  hide(): void {
    this.pill.hidden = true;
  }

  private pick(minutes: number): void {
    this.minutes = minutes;
    [...this.chips.children].forEach((b, i) => b.classList.toggle("on", LENGTHS[i] === minutes));
  }
}
