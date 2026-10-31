// Cuts streaming text into sentences to synthesize one at a time, so speech starts with the first
// sentence instead of waiting for the whole reply.

const END = /[。！？!?…\n]+["'”’）)]*|[.;；](?=\s|$)/g;
/** Shorter pieces wait to join the next sentence ("嗯。" alone sounds clipped). */
const MIN_CHARS = 4;
/** Without an ending, a long run is cut at a comma so the first audio is not delayed. */
const MAX_CHARS = 60;

export function splitSentences(buffer: string, flush = false): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  let pending = "";
  for (const m of buffer.matchAll(END)) {
    const end = m.index! + m[0].length;
    const piece = pending + buffer.slice(start, end);
    start = end;
    if (piece.trim().length < MIN_CHARS) {
      pending = piece;
      continue;
    }
    sentences.push(piece.trim());
    pending = "";
  }
  let rest = pending + buffer.slice(start);
  if (rest.length > MAX_CHARS) {
    const cut = Math.max(rest.lastIndexOf("，", MAX_CHARS), rest.lastIndexOf(",", MAX_CHARS), rest.lastIndexOf("、", MAX_CHARS));
    const at = cut > MIN_CHARS ? cut + 1 : MAX_CHARS;
    sentences.push(rest.slice(0, at).trim());
    rest = rest.slice(at);
  }
  if (flush && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences: sentences.filter(Boolean), rest };
}

/** Self-talk lines come wrapped in parentheses, which MiMo would read as a stage direction. */
export function speakable(sentence: string): string {
  return sentence.replace(/^[（(](.*)[）)]$/s, "$1");
}
