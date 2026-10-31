// Streaming parser for the control tags the model embeds in replies:
//   [emo:shy]  switch expression     [act:point]  play a gesture     [remember: likes cats]  store a fact
// Tags are removed from the visible text. A tag split across stream chunks is held back until it closes.

export type TagEvent = { kind: "emo" | "act" | "remember"; value: string };

const TAG = /\[(emo|act|remember)\s*:\s*([^\]\n]{1,200})\]/gi;
/** An unclosed "[" this close to the end might still become a tag; longer means it is just text. */
const MAX_PENDING = 210;

export class TagParser {
  private pending = "";

  /** Feeds a chunk; returns the text that is now safe to show and the tags completed by it. */
  feed(chunk: string): { text: string; events: TagEvent[] } {
    let input = this.pending + chunk;
    this.pending = "";

    const open = input.lastIndexOf("[");
    if (open >= 0 && !input.includes("]", open) && input.length - open <= MAX_PENDING && couldBeTag(input.slice(open))) {
      this.pending = input.slice(open);
      input = input.slice(0, open);
    }
    return extract(input);
  }

  /** Ends the stream; whatever was held back is shown as plain text. */
  flush(): { text: string; events: TagEvent[] } {
    const rest = this.pending;
    this.pending = "";
    return extract(rest);
  }
}

function couldBeTag(fragment: string): boolean {
  const name = fragment.slice(1).trimStart().split(/[\s:]/)[0].toLowerCase();
  return ["emo", "act", "remember"].some((t) => t.startsWith(name) || name.startsWith(t));
}

function extract(input: string): { text: string; events: TagEvent[] } {
  const events: TagEvent[] = [];
  const text = input.replace(TAG, (_, kind: string, value: string) => {
    events.push({ kind: kind.toLowerCase() as TagEvent["kind"], value: value.trim() });
    return "";
  });
  return { text, events };
}

/** Tidies spacing left behind by removed tags. */
export function cleanText(text: string): string {
  return text.replace(/[ \t]{2,}/g, " ").replace(/^\s+/, "");
}
