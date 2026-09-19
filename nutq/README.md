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

Entered in Settings and stored in the **Windows Credential Manager**, not in
any file this project writes. There are five slots; the UI marks each one
required, saved-but-unused, or not needed, based on the providers you picked:

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
install starts with six — Dictation (`F8`), Proofread (`Ctrl+F8`),
Checklist (`Ctrl+F9`), Idea → Spec (`Ctrl+F10`), Notes (`Ctrl+F11`), and
Ideas (`Ctrl+F12`) — and lines can be added, removed, renamed, and re-keyed
on the Settings Lines tab. Each line picks its own mode or carries entirely
custom instructions, its own destination (paste in place, open for review,
or file on the Notes page), and optionally its own STT and refinement
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

- **Paste** — into whatever field has focus when the recording ends.
- **Review** — brings the window forward with the result to read and edit,
  and puts it on the clipboard.

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

### History

Every result is kept — last 500, this machine only — with both its raw
transcript and its refined text; the newest 100 also keep their audio. When a
result does not land, **Regenerate** on the entry runs it through the
providers selected in Settings *right now* (same mode, new wording) and
updates that entry in place: from the kept audio when the recording still
exists — a bad transcription gets a second chance too — and over the saved
raw transcript once the audio has aged out. Calls that failed on every
provider are a different thing: those are parked for retry on the Home page.

### Updating

From v0.3.0 on, the app updates itself. Releases live on GitHub, and on
open (plus every four hours) the Home page quietly asks GitHub whether a
newer one exists. When it does, a **New version available** card appears:
one click downloads the installer, verifies its signature against the public
key baked into the app, installs it, and relaunches — no browser, no manual
download. `scripts/publish-release.ps1` is the publishing side of that:
signed build, `latest.json`, push, GitHub Release, in one command.

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
| `src-tauri/src/logs.rs` | The warning/error log, and the overlay's diagnostic trail |
| `nutq/scripts/publish-release.ps1` | Signed build + GitHub Release + `latest.json` |
| `src-tauri/src/lib.rs` | Commands, hotkeys, tray, pipeline |
| `src/lib/api.ts` | Typed bridge to the Rust commands |

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
