/**
 * The interface language.
 *
 * English is the source text and the key: every visible string is written in
 * English at its call site and passed through `t()`, which looks it up in the
 * Arabic table when the window speaks Arabic. A string missing from the table
 * falls back to its English - never to an empty label - and
 * `npm run i18n:check` lists every `t("...")` the table does not cover yet.
 *
 * `{name}` placeholders are filled from the second argument, so word order is
 * the translation's business: "{n} open" can become "{n} مفتوحة" or
 * "مفتوحة: {n}" without the call site knowing.
 *
 * The language is module state rather than React context on purpose: App sets
 * it during its own render (before any page renders), and every page is a
 * child App re-renders, so a switch repaints the whole window without
 * remounting it - Settings keeps its unsaved draft while you try Arabic on.
 */

import { AR } from "./i18n.ar";

/** What the user picks. "system" follows the Windows display language. */
export type UiLanguage = "system" | "en" | "ar";
/** What the window actually speaks. */
export type Lang = "en" | "ar";

let current: Lang = "en";

export function resolveLanguage(choice: UiLanguage): Lang {
  if (choice === "en" || choice === "ar") return choice;
  const nav = typeof navigator === "undefined" ? "" : navigator.language;
  return nav.toLowerCase().startsWith("ar") ? "ar" : "en";
}

/**
 * Switch the strings `t()` returns. Called during render, so it only touches
 * module state; `applyDirection` does the DOM half from an effect.
 */
export function setLanguage(choice: UiLanguage) {
  current = resolveLanguage(choice);
}

/**
 * Write the language onto <html>: `lang` picks Arabic shaping and fonts,
 * `dir` flips every flex row, grid and logical margin in the stylesheet, and
 * the `[lang="ar"]` block in styles.css retunes the type tokens for connected
 * script.
 */
export function applyDirection() {
  const el = document.documentElement;
  el.lang = current;
  el.dir = current === "ar" ? "rtl" : "ltr";
}

export function lang(): Lang {
  return current;
}

/** Translate one English string, filling `{placeholders}` from `vars`. */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = current === "ar" ? (AR[en] ?? en) : en;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
