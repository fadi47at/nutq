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
- Release ritual, in order: bump the three files → `npm run tauri build`
  (in `nutq/`) → commit → tag `v<version>`.
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
