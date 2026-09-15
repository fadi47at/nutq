# AGENTS.md

Working agreement for anyone — human or AI — touching this repository.
Read it before starting work. Keep it true before finishing work (see
"Keep the docs true").

## What this is

**nutq** is a voice-to-text desktop app: press a hotkey anywhere, speak, get
finished text pasted where you were typing. It is **under active
development** — nothing here is frozen, and a change to how something works
is a change to the documents that describe it, in the same commit.

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
- **A refused hotkey is retried** (`spawn_hotkey_retry`, every 30s). Windows
  gives a global hotkey to whoever asks first; a binding that lost that race
  must not stay dead until the next launch.
- **The overlay writes its own trail** to `overlay.log` in the config dir
  (`logs::diag`) — placements, pill show/clear, repairs, recoveries. The
  installed build captures no stderr, so this file is the only evidence after
  an intermittent failure. `logs.json` stays for things the user should read.

## Build & verify (Windows)

- Dev run: `npm install` then `npm run tauri dev` (in `nutq/`).
- Release build: `npm run tauri build` — runs `tsc` + Vite first; a failure
  there is a stop sign, not a warning.
- Rust: `cargo check` / `cargo test` in `nutq/src-tauri/`.
- Install location on this machine: `%LOCALAPPDATA%\nutq\nutq.exe`
  (NSIS `currentUser` mode). Silent update: quit the running app, then run
  the setup `.exe` with `/S`.
- **Single instance is a hard requirement.** `tauri-plugin-single-instance`
  is the FIRST plugin registered in `nutq/src-tauri/src/lib.rs`; it must stay
  first. Launching the exe again must focus the already-running app, never
  spawn a second process (second tray icon = broken build).
