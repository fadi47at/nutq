# nutq

Press a hotkey anywhere in Windows, speak, get finished text pasted where you were typing.

Audio never touches the disk. API keys never touch the settings file.

## Prerequisites

WebView2 ships with Windows 11, so only two things are missing on a clean machine:

1. **Microsoft C++ Build Tools** — https://visualstudio.microsoft.com/visual-cpp-build-tools/
   Select the **Desktop development with C++** workload during install.
2. **Rust** — https://rustup.rs (run `rustup-init.exe`, take option 1)

Close and reopen your terminal afterwards so `cargo` is on `PATH`.

## Run

```bash
npm install
npm run tauri dev
```

The first Rust build compiles the whole dependency tree and takes several
minutes. Later builds are incremental and fast.

## Build the installer

```bash
npm run tauri build
```

Produces an NSIS `.exe` and an `.msi` under
`src-tauri/target/release/bundle/`.

## Releases and versions

The version lives in three files that move together: `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`. Every user-visible
change gets a bump (patch for fixes, minor for features), every build gets a
git tag (`v<version>`), and no two builds ever share a number. The ritual in
order: bump the three files → `npm run tauri build` → commit → tag.

The running app shows its version in the sidebar, so it is always visible
which release is actually installed. The macOS CI derives its dmg filename
from `tauri.conf.json`, so a bump there renames the artifact on the next
run. See `AGENTS.md` at the repo root for the full working agreement.

## How it works

```
hotkey → cpal capture (16 kHz mono, in memory)
       → stage 1           raw transcript
       → stage 2           finished text, per the selected mode
       → clipboard + Ctrl+V into the focused field
```

The two stages are deliberately separate. Transcription is told to transcribe
and nothing else, so when output is wrong it is always obvious which stage to
blame — and the raw transcript is kept in History next to the refined one.

## Providers

Each stage picks its own provider and model in Settings. Nothing is hardcoded
to one vendor.

**Stage 1 — speech to raw transcript**

| Provider | Notes |
|---|---|
| Gemini | Best on Levantine Arabic mixed with English. Takes audio inline. Cost tracked. |
| ElevenLabs Scribe | Purpose-built transcriber, strong multilingual accuracy. |
| Any OpenAI-compatible endpoint | `POST {base}/audio/transcriptions` — OpenAI, Groq, a local whisper server. |

**Stage 2 — transcript to finished text**

| Provider | Notes |
|---|---|
| Claude | Effort tuned per mode: low for cleanup, high for Spec. Cost tracked exactly. |
| Gemini | Reuses the Gemini key, so one account covers both stages. Cost tracked. |
| Any OpenAI-compatible endpoint | `POST {base}/chat/completions` — GLM, DeepSeek, OpenRouter, Groq, local servers. |

The custom option takes a base URL and a free-text model name, so any service
speaking those two shapes works without a code change. Known bases are one
click away under the URL field.

**GLM has two separate endpoints** — `api.z.ai` (international) and
`open.bigmodel.cn` (mainland China) — with separate accounts and keys. A key
issued for one is rejected by the other with a plain 401, which is
indistinguishable from a bad key. Both are in the quick links; if the key is
definitely right, try the other host.

### Test this stage

Each stage box has a **Test this stage** button that runs one real request
through the same code path a dictation uses — same URL, key, and model. Stage 1
sends 0.3 seconds of silence; stage 2 sends a one-word prompt.

The result tells you *which* of the four possible things is wrong:

| What comes back | What it means |
|---|---|
| could not reach the endpoint | URL or network. Nothing was sent, so the key is irrelevant. |
| refused the key (401) | The endpoint is reachable. Credential problem only. |
| nothing exists at that address (404) | Base URL wrong, or the model name does not exist there. |
| rejected the request (400) | Usually an unsupported model name. |
| not the expected shape | The URL points at something that is not this kind of API. |

Every message names the exact URL that was called, so a wrong base URL is
visible rather than inferred. Pasting the full endpoint (with
`/chat/completions` on the end) is handled — that suffix is stripped rather
than doubled.

Cost tracking only covers providers with published per-token rates. When a
custom endpoint is selected the month total says so rather than quietly
under-reporting.

## API keys

Entered in Settings › API keys and stored in the **Windows Credential
Manager**, not in any file this project writes. There are five slots, split
into the ones your current providers actually read and the ones nothing reads
right now, so "which key is missing" is answerable without knowing the
internals. A saved key can be forgotten from the same row; like everything
else on that page it happens on Save, and Discard undoes it.

| Slot | Used by |
|---|---|
| `gemini` | Gemini, in either stage |
| `anthropic` | Claude |
| `elevenlabs` | ElevenLabs Scribe |
| `stt_custom` | the stage 1 custom endpoint |
| `refine_custom` | the stage 2 custom endpoint |

The two custom slots are separate because the endpoint transcribing your audio
is usually a different service, with a different key, from the one refining it.

Refinement can be switched off entirely, in which case only the stage 1 key is
needed and the raw transcript is pasted.

### Writing modes

Modes are not different pipelines, just different system prompts
(`src-tauri/src/modes.rs`):

| Mode | What it does | Effort |
|---|---|---|
| Natural | Removes filler, false starts, and thinking-out-loud repetition | low |
| Verbatim | Punctuation and spelling only, otherwise faithful | low |
| Spec | Turns a rambling idea into Goal / Requirements / Constraints / Open questions | high |
| Summary | Tight bullet points | medium |
| Checklist | Spoken tasks become a tickable to-do list, filed on the To-do page | medium |

Spec mode is the reason this exists rather than just using a dictation app:
talk through an idea for five minutes and get back a brief you can hand
straight to a coding agent.

### Lines

A dictation "line" is one hotkey plus one set of processing choices. A fresh
install starts with seven — Dictation (`F8`), Proofread (`Ctrl+F8`),
Checklist (`Ctrl+F9`), Idea → Spec (`Ctrl+F10`), Notes (`Ctrl+F11`),
Ideas (`Ctrl+F12`), and Think aloud (`Ctrl+F7`) — and lines can be added,
removed, renamed, and re-keyed in Settings › Lines. Each line picks its own
mode or carries entirely custom instructions, its own destination (paste in
place, open for review, file on the Notes page, or grow an idea thread), and
optionally its own STT and refinement
models; anything it leaves unset falls through to the shared settings. The
Checklist line also files its result as tickable items on the To-do page,
so a list spoken in the morning can be worked from that evening.

### Notes

A line whose destination is "Notes" does not paste: its finished text is
filed on the Notes page, tagged with a kind that follows the line's mode —
**Cleaned** (Natural), **As spoken** (Verbatim), or **Idea** (Spec and
Summary). The page shows every note with those properties, lets the kind be
changed after the fact, and keeps the text editable, because dictation is a
starting point. Settings written before the Notes lines existed get them
appended once on first load; a deleted Notes line stays deleted.

### Destinations

Each line picks its own destination:

- **Paste it** — into whatever field has focus when the recording ends.
- **Show it here** — brings the window forward with the result to read and
  edit, and puts it on the clipboard.
- **File a note** — nothing is pasted; the text lands on the Notes page.
- **Grow an idea** — nothing is pasted; the thought joins an idea thread
  (below).

### Idea threads

Thinking out loud, kept. A line whose destination is **Grow an idea** (the
Think aloud line, `Ctrl+F7`, out of the box) files each thought into the
*idea it belongs to* - a thread - and rewrites that thread's living
document to take it in: the idea in brief, details, decisions, open
questions, next steps, in the language you speak. An idea told in pieces
over a week ends up as one document, with a "what changed" line on top
saying what the latest thought added.

- **Routing.** When a thread is **pinned**, every thought goes there. When
  none is, the refinement provider is shown the threads (title and the head
  of each document) and picks the one the thought continues, or starts a
  new one - when unsure it starts a new one, because a wrong merge is worse.
- **Nothing is lost to a provider.** The thought is saved first; the
  document rewrite comes after, in the background, so the next dictation
  can start at once. If the rewrite fails, the thread says its document is
  behind and **Rebuild** redoes it from every thought.
- **Two more calls per thought** (route, then rewrite), both on the
  Refinement provider and its backup - a thread line needs that key even
  with refinement skipped. The line's own processing mode still runs first
  and cleans the thought. These calls are not History rows, so their cost
  is not in the month total.
- The **Idea threads** page lists the ideas, shows the open one's document,
  takes typed thoughts too (`Ctrl+Enter`), and keeps every thought as the
  record the document was built from. Renaming a thread stops the model
  from renaming it; an empty name hands naming back.
- Settings written before threads existed get the Think aloud line
  appended once; a deleted one stays deleted. Stored in `threads.json` in
  the config dir.

### The window

One stylesheet, one token vocabulary. `src/styles.css` defines the palette,
the type scale, the spacing and the shadows once as CSS variables;
`[data-theme="dark"]` redefines the same names, and `.zone-dark` redefines
them again for the sidebar, so a component reads `--text` and `--surface` and
gets whichever zone it is sitting in. Nothing outside that file names a
colour. **Settings › Appearance** switches between Light, Dark, and
following Windows; the choice is stored like any other setting and applies the
moment it is picked.

`src/lib/ui.tsx` holds the pieces every page is built from - `PageHead`,
`Field`, `Toggle`, `Empty`, `Kbd`, and the icon set - so a new page starts
looking like the rest of the app rather than like itself. Hotkeys are drawn as
keycaps by `Kbd` everywhere they appear.

Settings is a draft until it is saved. The section list on the left groups the
eight sections (Dictation / Engine / Application) and marks the ones that need
attention; the bar pinned to the bottom says whether anything is unsaved and
carries Save and Discard, with `Ctrl+S` as the shortcut. A blank that would
have become a 404 from a provider is caught there, and the page jumps to the
section holding it.

### Arabic and English

The window speaks English or Arabic - **Settings › Appearance › Language**, or
"Match Windows", which follows the Windows display language. Like the theme,
the pick applies the moment it is made and Discard takes it back. Arabic turns
the whole window right-to-left: the sidebar moves to the right, rows and grids
mirror, and the all-caps tracked labels drop their tracking (it pulls Arabic
letters apart). A few things stay left-to-right on purpose in both languages:
hotkey keycaps, timestamps, the model chain, the usage chart's time axis, and
the recording pill itself - only its words change.

This is the interface only. What you *dictate* is governed by the Language
hint under Audio & input, not by this setting.

How it works: every visible string is written in English at its call site and
passed through `t()` (`src/lib/i18n.ts`); the Arabic for it lives in
`src/lib/i18n.ar.ts`, keyed by that English. A missing translation falls back
to English rather than to a blank. `npm run i18n:check` lists any string that
has no Arabic yet (and any Arabic nothing uses); it also runs in Windows CI and
fails the build on a gap. To add a language, add a table next to the Arabic one
and a branch in `i18n.ts`.

The Rust side speaks the same language: provider diagnostics, the warnings
and errors in the toasts and on the Logs page, and the tray menu go through
`tr()`/`trf()` (`src-tauri/src/i18n.rs`), with the Arabic in
`src-tauri/src/i18n_ar.rs`. A `cargo test` fails on any Rust string without
Arabic, on Arabic nothing uses, and on a translation that drops a
`{placeholder}`. Messages are translated when they are made, so a log entry
written in English stays English after a switch. "Match Windows" reads the
Windows display language directly, so the tray is right from launch.

Not translated on purpose: the names of the default lines (Dictation,
Proofread, ...) are your data, not the app's words - rename them in
Settings › Lines - and raw text quoted from a provider or from Windows
("It said: ...") stays as it was sent.

### What the pill says

The pill is the only part of nutq you see while you are speaking, so it says
what is being made rather than what it is called. Its head is the recording
line's own glyph - a mic for dictation, a note for a notes line, a bulb for an
idea, a checklist, quote marks for word-for-word, a wand for a line with your
own instructions - and the same glyph sits on that line's Home tile and its
row in Settings, so the button you press and the pill that appears are
obviously the same thing. The mapping lives in `Profile::kind`
(`src-tauri/src/settings.rs`) and `lineKind` (`src/lib/ui.tsx`); the two
mirror each other.

Settings › Recording pill decides the rest: the head can be the glyph, the
classic red dot, or nothing at all; the line's name can be written out next to
the timer as well; the wave has five shapes; and the theme - 29 of them,
Night and Day - sets the glow, the wave and the background together, each
swatch drawn as a miniature of the pill itself. Day themes darken the
quiet-mic colour, which would otherwise vanish on a pale pill.

### The recording indicator

The pill that appears above the taskbar while the mic is live is its own
transparent WebView2 window, and one rule keeps it appearing: that window is
**never hidden and never moved off screen**. Hiding a WebView2 window suspends
its renderer, and a window whose pixels all sit outside every monitor is
treated by Chromium as occluded — either way the pill can come back blank, and
a blank surface on a transparent window is invisible. That is what "I pressed
the hotkey and no pill appeared, until I restarted the app" was. When the pill
is idle the page simply draws nothing, which is the whole of "hidden".

Nothing outside the page can tell whether the pill actually drew, so the page
proves it: its state poll and a `requestAnimationFrame` tick are both reported
to Rust, and a supervisor thread checks those two clocks every five seconds.
Quiet clocks mean a reload of the page; if that does not bring it back, the
window itself is rebuilt. Either way there is no restart. Every placement,
show, repair and recovery is appended to `overlay.log` beside the settings
file (`%APPDATA%\nutq\nutq\config\overlay.log`, newest last, 400 lines), which
is how "why did the pill not appear at 17:42" is answered after the fact — the
installed build captures no stderr at all.

The hotkeys get the same treatment. Windows gives a global hotkey to whoever
asks first, so a binding refused at startup — or taken later by another app —
is retried every 30 seconds rather than leaving the hotkey dead until the next
launch.

And so does the microphone: a start that Windows refuses with "device in
use" is retried in the background — four attempts, 1.5 s apart — before the
error is shown, because a Bluetooth headset finishing a mode switch or
another app letting go of the mic clears within seconds. Any other failure
(a vanished mic, a refused format) is reported at once.

### History

Every result is kept — last 500, this machine only — with both its raw
transcript and its refined text; the newest 100 also keep their audio. When a
result does not land, **Regenerate** on the entry runs it through the
providers selected in Settings *right now* (same mode, new wording) and
updates that entry in place: from the kept audio when the recording still
exists — a bad transcription gets a second chance too — and over the saved
raw transcript once the audio has aged out. Calls that failed on every
provider are a different thing: those are parked for retry on the Home page.
An entry that still has its recording can also put the **audio itself** on
the clipboard as a file - the way Explorer copies a file - to paste into a
chat that takes voice notes, an upload box, or a folder. The copy is an
mp3 - every chat accepts it, wav most refuse - named for what it is: the
date and the first words said, so it introduces itself in the chat it
lands in.

### Notifications and the log

Everything the app has to say lands in the sidebar's message slot and, for
good, on the Logs page - at one of three levels, so the colour means
something:

- **Error** (red) - something did not happen: transcription failed on
  every provider, the microphone could not open. Stays until dismissed.
- **Warning** (amber) - something may need you: refinement failed and the
  raw transcript was used, an idea's document fell behind.
- **Notice** (grey, faded) - worth knowing, needs nothing: nothing was
  heard, the recording was too short, the backup provider stepped in and
  the dictation went through, a hotkey came back. It leaves on its own after
  a few seconds and never lights the rail's dot.

A message's first paragraph is its summary - all the toast shows; the
provider's own reply and the URL called sit under it on the Logs page,
behind **Show the details**. The page filters by level.

**A blip is not a failure.** Before a dictation is called failed, the main
provider and the backup are each tried; when both failed for a reason that
passes on its own - a dropped connection, a timeout, an overloaded model
(5xx), a rate limit that outlasted its retries - the whole round runs once
more after three seconds. Those cases are a type (`net::Transient`), not a
phrase matched in the message, so they work in Arabic too. A wrong key, a
missing model or a bad URL is never retried that way: it would only fail
again, slower.

### Updating

From v0.3.0 on, the app updates itself. Releases live on GitHub, and on
launch (plus every ten minutes) the app quietly asks GitHub whether a newer
one exists - one small request, invisible offline. When one does, two
things say so: a **New version available** card on the Home page (one click
downloads the installer, verifies its signature against the public key
baked into the app, installs it, and relaunches — no browser, no manual
download) and a notice in the sidebar's message slot, next to the log
notices, with its own Dismiss. There, one Dismiss clears every pending
notice at once - no queue to drain one press at a time - and the full
history stays on the Logs page.
`scripts/publish-release.ps1` is the publishing side of that: signed
build, `latest.json`, push, GitHub Release, in one command.

## Source map

| File | Responsibility |
|---|---|
| `src-tauri/src/audio.rs` | cpal capture on a dedicated thread, downmix, resample, trim, WAV |
| `src-tauri/src/stt.rs` | Gemini transcription |
| `src-tauri/src/refine.rs` | Claude refinement |
| `src-tauri/src/modes.rs` | Every prompt in the app |
| `src-tauri/src/inject.rs` | Clipboard save / paste / restore |
| `src-tauri/src/settings.rs` | Settings, profiles (lines), history, credential store |
| `src-tauri/src/todos.rs` | The to-do lists the Checklist line files |
| `src-tauri/src/notes.rs` | The notes and ideas the Notes lines file |
| `src-tauri/src/threads.rs` | Idea threads: storage, routing and rewrite prompts, the growth that runs after a thought |
| `src-tauri/src/logs.rs` | The warning/error log, and the overlay's diagnostic trail |
| `src-tauri/src/hotkeys.rs` | Parsing specs, registering line bindings, the Escape rescue key, the 30s retry |
| `nutq/scripts/publish-release.ps1` | Signed build + GitHub Release + `latest.json` |
| `src-tauri/src/lib.rs` | Commands, tray, the pipeline that drives a dictation |
| `src/lib/api.ts` | Typed bridge to the Rust commands |
| `src/lib/ui.tsx` | Shared UI pieces: PageHead, Field, Toggle, Kbd, icons, theme |
| `src/views/ThreadsView.tsx` | The Idea threads page |
| `src/lib/i18n.ts` | The interface language: `t()`, Arabic/English, right-to-left |
| `src/lib/i18n.ar.ts` | The Arabic for every UI string, keyed by its English |
| `src-tauri/src/i18n.rs` | The Rust side's language: `tr()`, `trf()`, Windows language detection |
| `src-tauri/src/i18n_ar.rs` | The Arabic for every Rust message |
| `scripts/check-i18n.mjs` | `npm run i18n:check`: strings with no Arabic yet |
| `src/styles.css` | The design tokens and every component style, light and dark |

## Notes

- `src/lib/devMock.ts` lets `npm run dev` render the UI in a plain browser with
  fake data, so the frontend can be iterated without a Rust rebuild. Vite drops
  it from production builds.
- One instance at a time: launching the exe while the app is running just
  brings its window forward (`tauri-plugin-single-instance`, registered first
  in `src-tauri/src/lib.rs`). Closing the window hides it; the app keeps
  running from the tray until Quit.
- Recording is capped at 5 minutes. Gemini takes audio inline up to ~20 MB;
  going longer means switching `stt.rs` to the Files API.
- The Gemini cost figure in the usage counter is an estimate from published
  per-token rates. The Claude figure is exact.
- Keeping this checkout inside OneDrive will make Rust builds slow — the
  `target/` directory is several GB of small files. Exclude the folder from
  sync.
