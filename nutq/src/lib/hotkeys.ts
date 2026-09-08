/**
 * Turning a real keypress into a spec the Rust parser accepts, and back into
 * something readable.
 *
 * Typing the spec by hand was the whole problem. The parser splits on `+`
 * before it looks at anything else, so the plus key cannot be written as "+" -
 * it is "NumpadAdd", and nothing in the UI said so. Capturing the keypress
 * removes the guesswork: the browser's `KeyboardEvent.code` uses the very same
 * vocabulary the parser does ("F8", "NumpadAdd", "KeyK", "Digit1"), so the
 * code goes through untranslated.
 */

/** Held-down keys that are a modifier, not the key being bound. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** `KeyboardEvent` -> a spec, or null while only modifiers are down. */
export function specFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(e.code);
  return parts.join("+");
}

/** Names for keys whose code is not readable on its own. */
const KEY_LABELS: Record<string, string> = {
  NumpadAdd: "Numpad +",
  NumpadSubtract: "Numpad −",
  NumpadMultiply: "Numpad *",
  NumpadDivide: "Numpad /",
  NumpadDecimal: "Numpad .",
  NumpadEnter: "Numpad Enter",
  NumpadEqual: "Numpad =",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Equal: "=",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Control: "Ctrl",
  Super: "Win",
  CmdOrControl: "Ctrl",
  CommandOrControl: "Ctrl",
};

function labelPart(part: string): string {
  if (KEY_LABELS[part]) return KEY_LABELS[part];
  // KeyK -> K, Digit1 -> 1, Numpad7 -> Numpad 7; anything else as written.
  if (/^Key[A-Z]$/.test(part)) return part.slice(3);
  if (/^Digit[0-9]$/.test(part)) return part.slice(5);
  if (/^Numpad[0-9]$/.test(part)) return `Numpad ${part.slice(6)}`;
  return part;
}

/** "Control+NumpadAdd" -> "Ctrl + Numpad +". Readable, never re-parsed. */
export function prettyHotkey(spec: string): string {
  if (!spec.trim()) return "not set";
  return spec.split("+").filter(Boolean).map(labelPart).join(" + ");
}
