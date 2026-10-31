// "Look at my screen": she only looks when asked, from the menu or in so many words.

const LOOK_REQUEST =
  /(看|瞅|瞧)(一下|一眼|看)?.{0,4}(屏幕|电脑|画面|这个|这里|这儿)|屏幕上|\b(look|see|check)\b.{0,12}\b(screen|this)\b|what('?s| is) on (my|the) screen/i;

export function isLookRequest(text: string): boolean {
  return LOOK_REQUEST.test(text);
}
