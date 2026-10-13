// Lists every English UI string the Arabic table (src/lib/i18n.ar.ts) does
// not cover, and every table entry nothing uses any more.
//
// It reads the first argument of each t("...") call, plus the English source
// text kept elsewhere and passed through t() where it is drawn: label fields
// in tables (name:, hint:, group:, label:, where:, placeholder:, sub:,
// title:), id-keyed lookup records, the rail's tuples, and plain JSX copy
// attributes. Single lowercase words in tables (ids such as "idle") are
// skipped, so those are checked by eye. Proper names that stay as they are in
// every language - providers, hosts - are listed in KEEP below.
//
//   npm run i18n:check
//
// Exits 1 when anything is missing, so CI holds the line.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: on Windows the latter is "/C:/..." and
// readdirSync cannot open it.
const root = fileURLToPath(new URL("../src/", import.meta.url));

/** Proper names: never translated, so never reported. */
const KEEP = new Set([
  "Gemini", "Claude", "ElevenLabs", "ElevenLabs Scribe", "DeepSeek", "OpenRouter",
  "Groq", "OpenAI", "GLM · international", "GLM · China", "GLM · coding plan",
  "aistudio.google.com", "console.anthropic.com", "elevenlabs.io",
  "AIza...", "sk-ant-...", "sk_...", "English", "العربية", "من اليمين إلى اليسار",
  // Not copy: a format note in a comment, and the doc example in i18n.ts.
  "HH:00", "...",
]);

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(f) && !/i18n\.ar\.ts$|devMock\.ts$/.test(f) ? [p] : [];
  });
}


/** The value of a "double" or 'single' quoted literal's body. */
function unescape(dq, sq) {
  const body = dq ?? sq.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"');
  return JSON.parse('"' + body + '"');
}

const used = new Map(); // string -> first file seen
const str = String.raw`"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'`;
const callRe = new RegExp(String.raw`\bt\(\s*(?:${str})`, "g");
const tableRe = new RegExp(String.raw`\b(?:name|hint|group|label|where|placeholder|sub|title):\s*(?:${str})`, "g");
// Lookup tables keyed by id - `idle: "waiting for your hotkey",` - and the
// rail's tuples - `["home", "Home", "home"]`.
const recordRe = new RegExp(String.raw`^\s+[a-z_]+:\s*(?:${str}),?\s*$`, "gm");
const tupleRe = new RegExp(String.raw`\[\s*"[a-z_]+",\s*(?:${str})`, "g");
// Plain JSX attributes that carry copy: either a component translates them
// itself (SectionHead's title/sub, TestButton's hint), or they are a string
// that was missed - both belong in the table.
const attrRe = /\b(?:title|sub|hint|placeholder|aria-label|eyebrow|lede|name)="([^"]*)"/g;

for (const f of files(root)) {
  const src = readFileSync(f, "utf8");
  const rel = f.slice(root.length).split(sep).join("/");
  for (const re of [callRe, tableRe, recordRe, tupleRe, attrRe]) {
    for (const m of src.matchAll(re)) {
      const s = re === attrRe ? m[1] : unescape(m[1], m[2]);
      // Ids and css-ish values are not copy.
      if (re !== callRe && !/[A-Za-z]{2}/.test(s)) continue;
      if (re !== callRe && /^[a-z_]+$/.test(s)) continue;
      if (re !== callRe && /^[\w.-]+\/|^https?:|^[a-z0-9.-]+$|^CmdOrControl/.test(s)) continue;
      if (!used.has(s)) used.set(s, rel);
    }
  }
}

const arSrc = readFileSync(join(root, "lib/i18n.ar.ts"), "utf8");
const keys = new Set();
for (const m of arSrc.matchAll(new RegExp(String.raw`^\s*(?:${str}|([A-Za-z_$][\w$]*))\s*:`, "gm"))) {
  keys.add(m[3] ?? unescape(m[1], m[2]));
}

const missing = [...used].filter(([s]) => !keys.has(s) && !KEEP.has(s));
// A key no scan found may still be drawn through a lookup of single-word ids
// (t(STATUS_NAME[status])); it is only stale if no source mentions it at all.
const allSrc = files(root).map((f) => readFileSync(f, "utf8")).join("\n");
const stale = [...keys].filter((k) => !used.has(k) && !allSrc.includes(JSON.stringify(k)));

for (const [s, f] of missing) console.log(`missing  ${f}: ${JSON.stringify(s)}`);
for (const k of stale) console.log(`unused   ${JSON.stringify(k)}`);
console.log(`\n${used.size} strings in use, ${keys.size} translated, ${missing.length} missing, ${stale.length} unused.`);
process.exit(missing.length ? 1 : 0);
