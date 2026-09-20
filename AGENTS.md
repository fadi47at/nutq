# AGENTS.md

Working agreement for anyone — human or AI — touching this repository.
Read it before starting work. Keep it true before finishing work (see
"Keep the docs true").

## What this is

**nutq** is a voice-to-text desktop app: press a hotkey anywhere, speak, get
finished text pasted where you were typing. Dictation is organized into
**lines** (`Settings.profiles`): each line is one global hotkey, one
Home-page button, and its own processing choices (mode or custom prompt,
destination, optional per-line STT/refine model overrides). The Checklist
line files its result as tickable items on the To-do page
(`src-tauri/src/todos.rs`). It is **under active development** — nothing
here is frozen, and a change to how something works is a change to the
documents that describe it, in the same commit.

- **Stack**: Tauri 2 (Rust backend) + React 19 / TypeScript / Vite frontend.
- **`nutq/`** — the application. All development happens here.
- **`nutq-macos/`** — macOS artifacts downloaded from CI. macOS is **not**
  built locally; it cannot be, on Windows.
- **`.github/workflows/build-macos.yml`** — builds the universal macOS dmg on
  Apple runners, triggered by push to `main` or manual dispatch.

## Versions

The version number lives in exactly three files, and they move **together**
or not at all:

1. `nutq/package.json`
2. `nutq/src-tauri/tauri.conf.json` — CI derives the macOS artifact name from
   this one
3. `nutq/src-tauri/Cargo.toml` (`Cargo.lock` follows on the next build)

Rules:

- **Every user-visible change ships with a version bump.** Two different
  builds must never carry the same version number. Patch (`0.1.x`) for fixes
  and small changes; minor (`0.x.0`) for new features.
- **Every release is a git tag.** After the build succeeds:
  `git tag -a v<version> -m "<what it is>"`. Tags are how releases are told
  apart later — a release without a tag does not exist.
- Release ritual, in order: bump the three files → commit → tag `v<version>`
  → `powershell -File scripts\publish-release.ps1 -Notes "what's new"`
  (in `nutq/`: signed build, push, GitHub Release with `latest.json`,
  installer copied to `versions/`). The only step left outside the script
  is installing on this machine - deliberately, so a release never kills
  the running app on its own.
- **Distribution is GitHub Releases + the built-in updater.** `nutq` reads
  `releases/latest/download/latest.json`, compares versions, and offers the
  update on its Home page; one click downloads the signed installer,
  verifies it, installs it, and relaunches. This exists from v0.3.0 on —
  older installs need one manual update first. The repo
  (`github.com/fadi47at/nutq`) is **public** on purpose: unauthenticated
  installs cannot see a private repo's releases, so privacy here would
  silently break every update.
- The updater signing key lives at `%USERPROFILE%\.nutq\updater.key`
  (private) — outside the repo, never committed; the matching public key is
  in `tauri.conf.json`. **Losing the private key breaks all future
  updates** — nothing can be signed for installed copies anymore.
- **Every release is installed on this machine, always.** The point of a
  build is that the user runs it, so the ritual does not end at the tag:
  quit the running nutq (tray → Quit, or `taskkill /IM nutq.exe`), run the
  new NSIS setup `.exe` with `/S`, start `%LOCALAPPDATA%\nutq\nutq.exe`
  again, and confirm the sidebar shows the new version number. A release
  that is tagged but not installed is not done.
- **Every release's installer is also copied to `versions/`**, next to the
  `nutq-for-friend/` folder at the repo root, so the current build is
  always one folder away to hand to someone. Like the friend folder it is
  local-only (gitignored); git history stays source-only — tags are how
  releases are told apart, not committed binaries.
- Windows installers land in `nutq/src-tauri/target/release/bundle/nsis/`.
  The running app shows its version in the sidebar (bottom of the rail), so
  "did the install take?" is answerable at a glance.

## No secrets. Ever.

- API keys are stored **only** in the OS credential store (Windows
  Credential Manager / macOS Keychain) via the `keyring` crate — never in
  source, never in settings files, never in this repository.
- **Before every commit**: run `git status` and `git diff` (staged *and*
  unstaged) and actually read what is going in. If anything resembles a key,
  token, password, or connection string — stop, remove it, and make sure the
  pattern is ignored.
- `.env` files, logs, dumps, or screenshots containing credentials do not
  get committed, even "temporarily".

## Keep the docs true

- **Before every git commit, and at the end of every session**, check that
  `AGENTS.md` and `nutq/README.md` still describe reality: architecture,
  workflow, commands, conventions.
- If the work changed how the app is built, tested, versioned, or released,
  update these files **in the same commit**. A stale document is a bug.
- A convention established mid-session (a gotcha discovered, a rule agreed
  on) is written down here before the session ends, not "later".

## The recording indicator

Rules learned the hard way — "I pressed the hotkey and no pill appeared until I
restarted the app" — and each one is load-bearing:

- **The pill's window is never hidden and never parked off screen.** Hiding a
  WebView2 window suspends its renderer; a window whose pixels all sit outside
  every monitor is occluded, and Chromium stops drawing it. Either one leaves a
  transparent window with nothing painted, which is invisible. Idle, the page
  draws nothing and the window stays where it belongs.
- **The page proves it is drawing.** Its state poll and a
  `requestAnimationFrame` tick are reported to Rust (`overlay_state`,
  `overlay_frame`); `spawn_overlay_watchdog` treats either clock going quiet as
  a dead pill, reloads the page, then rebuilds the window. Do not "simplify"
  this by hiding the window or by dropping the heartbeat.
- **`WS_EX_NOACTIVATE` is re-asserted after every window call**, because Tauri
  and wry rewrite `GWL_EXSTYLE` and silently wipe it. Without it the pill can
  take focus and break the paste at the end of a dictation.
- **Topmost is re-asserted like `WS_EX_NOACTIVATE`** (`ensure_topmost`, same
  three call sites). The `always_on_top` set at build time does not survive
  Tauri's style rewrites either — a lost topmost flag let the main window (or
  anything else) cover the pill, leaving a healthy, drawing window that was
  simply underneath. Diagnosed by `PrintWindow` (which shows the page's own
  rendering) disagreeing with `CopyFromScreen` (which shows what is on top).
- **A refused hotkey is retried** (`spawn_hotkey_retry`, every 30s). Windows
  gives a global hotkey to whoever asks first; a binding that lost that race
  must not stay dead until the next launch.
- **The overlay writes its own trail** to `overlay.log` in the config dir
  (`logs::diag`) — placements, pill show/clear, repairs, recoveries. The
  installed build captures no stderr, so this file is the only evidence after
  an intermittent failure. `logs.json` stays for things the user should read.

## The look

The UI is one design system, not a collection of pages, and it stays that way
by rule:

- **No component names a colour, a font size, or a radius.** They are tokens in
  `nutq/src/styles.css` (`--surface`, `--text-2`, `--fs-md`, `--r-lg`, ...).
  The dark theme is the same names redefined under `[data-theme="dark"]`, and
  the sidebar is the same names redefined again under `.zone-dark` - which is
  why one stylesheet serves a dark rail on a light page and a fully dark app.
  A hard-coded hex in a `.tsx` file is a bug.
- **Shared pieces live in `nutq/src/lib/ui.tsx`** - `PageHead`, `Field`,
  `Toggle`, `Empty`, `Kbd`, `Icon`. Every page opens with a `PageHead`; every
  hotkey is drawn by `Kbd`; every glyph comes from `Icon` (one 20px grid, 1.7
  stroke). Adding a one-off button style or a second icon set is how the app
  stops looking like one program.
- **One picture per kind of line.** What a line makes - dictation, a note, an
  idea, a checklist, word-for-word, your own instructions - has one glyph, and
  it shows in all three places that line appears: its Home tile, its row in
  Settings, and the head of the recording pill. The rule lives twice, in
  `Profile::kind` (Rust, for the pill) and `lineKind` (`src/lib/ui.tsx`, for
  the pages); changing one without the other makes the button you press and
  the pill that appears disagree.
- **Settings is a draft until saved.** The page edits a copy, the pinned bar
  reports whether anything is unsaved, and Save/Discard/`Ctrl+S` are the only
  ways out. Anything that writes immediately (an API key, a removed key) has
  to join that model rather than working behind it.
- **The theme is a setting** (`theme`: system/light/dark), applied by
  `applyTheme` in `lib/ui.tsx`. The recording pill keeps its own themes and is
  deliberately unaffected by it.

## Build & verify (Windows)

- Dev run: `npm install` then `npm run tauri dev` (in `nutq/`).
- Release build: `npm run tauri build` — runs `tsc` + Vite first; a failure
  there is a stop sign, not a warning.
- **Never let Windows PowerShell write repo JSON/TOML.** `Set-Content
  -Encoding UTF8` (and `Out-File`) prepend a BOM, and Vite's PostCSS config
  search then dies parsing `package.json`. Edit such files with the file
  tools, or write with `[Text.UTF8Encoding]::new($false)`.
- Rust: `cargo check` / `cargo test` in `nutq/src-tauri/`.
- Install location on this machine: `%LOCALAPPDATA%\nutq\nutq.exe`
  (NSIS `currentUser` mode). Silent update: quit the running app, then run
  the setup `.exe` with `/S`.
- **Single instance is a hard requirement.** `tauri-plugin-single-instance`
  is the FIRST plugin registered in `nutq/src-tauri/src/lib.rs`; it must stay
  first. Launching the exe again must focus the already-running app, never
  spawn a second process (second tray icon = broken build).
