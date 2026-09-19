mod audio;
mod clips;
mod discover;
mod inject;
mod logs;
mod modes;
mod net;
mod pending;
mod refine;
mod settings;
mod stt;
mod notes;
mod todos;

use audio::Recorder;
use base64::Engine;
use serde::Serialize;
use settings::{
    default_profiles, get_api_key, has_api_key, load_history, load_settings, save_history,
    save_settings, History, HistoryEntry, Mode, Output, Profile, Settings, ALL_PROVIDERS,
};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    Idle,
    Recording,
    Transcribing,
    Refining,
}

/// A frame, or a state poll, older than this means the pill's window has
/// stopped drawing. Generous on purpose: a repair is a reload the user may
/// catch a glimpse of, so a false positive is worth avoiding.
const OVERLAY_FRAME_STALE: Duration = Duration::from_secs(6);
const OVERLAY_POLL_STALE: Duration = Duration::from_secs(5);
/// How long a repair is given to take effect before it is judged again.
const OVERLAY_HEAL_GRACE: Duration = Duration::from_secs(8);

/// Health of the pill's window, as two independent clocks.
///
/// `poll` is fed by the overlay page's state poll and `frame` by a
/// requestAnimationFrame tick in that same page. The first proves the page is
/// running, the second proves its window is actually being composited - and a
/// compositor that has stopped is exactly the failure that leaves an
/// invisible pill on a transparent window.
#[derive(Default)]
struct OverlayWatch {
    frame: Option<Instant>,
    poll: Option<Instant>,
    /// When the last repair ran, and which rung of the ladder it was, so a
    /// renderer that cannot be revived is not reloaded in a tight loop.
    healed_at: Option<Instant>,
    stage: u8,
}

struct AppState {
    recorder: Recorder,
    settings: Mutex<Settings>,
    history: Mutex<History>,
    status: Mutex<Status>,
    /// Which line (profile) started the current recording. Decides the whole
    /// pipeline - mode, providers, output - so it is captured at press time
    /// rather than read from settings when the recording ends.
    pending_profile: Mutex<String>,
    /// The device the current recording is actually coming from, resolved when
    /// the stream opened. Same reasoning: read it at the start, not at the end,
    /// where a settings change mid-dictation would rewrite history.
    pending_mic: Mutex<String>,
    /// Each line's registered shortcut, paired with the line's id. One entry
    /// per profile, in settings order.
    shortcuts: Mutex<Vec<(Option<Shortcut>, String)>>,
    /// What each binding is actually doing, for the Settings page to show.
    /// Same order as the lines in settings.
    hotkey_report: Mutex<Vec<HotkeySlot>>,
    /// Whether Escape is currently bound as the "cancel this recording" key.
    /// Only true while the mic is live; the rest of the time Escape belongs
    /// to whatever app is being dictated into.
    escape_armed: Mutex<bool>,
    /// Freshness of the overlay's window, for the supervisor that keeps the
    /// pill able to draw. See `OverlayWatch`.
    overlay_watch: Mutex<OverlayWatch>,
}

impl AppState {
    fn status(&self) -> Status {
        *self.status.lock().unwrap()
    }

    fn set_status(&self, app: &AppHandle, s: Status) {
        let was = {
            let mut current = self.status.lock().unwrap();
            let was = *current;
            *current = s;
            was
        };
        eprintln!("[nutq] status -> {s:?}");
        let _ = app.emit("status", s);
        set_overlay_visible(app, s != Status::Idle);
        // Only the edges of a dictation change the pill: transcribing and
        // refining keep it up. Logging those edges, and not every transition,
        // is what makes the overlay log readable for days of use.
        if (was != Status::Idle) != (s != Status::Idle) {
            logs::diag(if s != Status::Idle {
                "pill: shown"
            } else {
                "pill: cleared"
            });
        }
    }
}

/// Shows or clears the little bottom-edge recording indicator.
///
/// "Hiding" here means the pill is not drawn, not that the window goes
/// anywhere: the window itself never leaves its place on screen and is never
/// hidden. Two failures came from doing otherwise, and both read as "I pressed
/// the hotkey and no pill appeared":
///
///   * a WebView2 window parked outside every monitor is treated by Chromium
///     as occluded, so its renderer stops producing frames - and a
///     transparent window with nothing painted is invisible;
///   * hiding the window suspends the renderer outright, and showing it again
///     after a long idle can fail to paint at all.
///
/// Neither was recoverable, because nothing ever checked whether the pill had
/// actually drawn - the window reported itself visible the whole time. That
/// check is `ensure_overlay_healthy`, and the supervisor that runs it is why a
/// stuck pill no longer needs the app restarted.
fn set_overlay_visible(app: &AppHandle, visible: bool) {
    let Some(w) = app.get_webview_window("overlay") else {
        eprintln!("[nutq] overlay: window not found");
        return;
    };
    // Defensive: the window was shown once at build; these are no-ops after
    // that, but guarantee the renderer is never left in a hidden state.
    let _ = w.show();
    let _ = w.as_ref().show();
    place_overlay(app);
    // Last, because Tauri re-applies its own extended style whenever a window
    // property changes - anything set before the calls above can be wiped by
    // them, which is how the pill ended up able to steal focus.
    if !ensure_no_activate(&w) {
        logs::diag("the overlay could not be marked no-activate; it may steal focus");
    }
    if !ensure_topmost(&w) {
        logs::diag("the overlay could not be raised topmost; windows may cover the pill");
    }
    // The one moment the pill must draw is the one moment it is worth
    // checking - and repairing, if its window has gone quiet.
    if visible {
        ensure_overlay_healthy(app);
    }
}

/// Puts the pill's window where it belongs - bottom center of the primary
/// monitor, a margin above the taskbar - and leaves it there.
///
/// The monitor is asked for on every call, so a docking, an unplug or a
/// resolution change is corrected by the next one; the first monitor is the
/// fallback when Windows will not name a primary.
fn place_overlay(app: &AppHandle) -> bool {
    let Some(w) = app.get_webview_window("overlay") else {
        return false;
    };
    let monitor = w
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| w.available_monitors().ok().and_then(|m| m.into_iter().next()));
    let Some(mon) = monitor else {
        logs::diag("no monitor could be resolved; the pill keeps its last position");
        return false;
    };
    let m = mon.size();
    let size = w.outer_size().unwrap_or_default();
    let margin = (64.0 * mon.scale_factor()) as u32;
    let x = (m.width.saturating_sub(size.width)) / 2;
    let y = m.height.saturating_sub(size.height + margin);
    let target = tauri::PhysicalPosition::new(x as i32, y as i32);
    // Moving a window that is already in place is needless work - and on a
    // transparent surface, a needless repaint.
    if w.outer_position().map(|p| p == target).unwrap_or(false) {
        return true;
    }
    match w.set_position(target) {
        Ok(()) => {
            logs::diag(&format!("pill window placed at ({x}, {y})"));
            true
        }
        Err(e) => {
            logs::diag(&format!("could not place the pill window: {e}"));
            false
        }
    }
}

/// Keeps the pill above every other window, including the app's own main
/// window - which is exactly what buried it: a dictation started from the main
/// window left that window sitting over the pill's spot, and the pill, no
/// longer topmost, drew underneath it and was invisible. Like the no-activate
/// bit below, the topmost flag does not survive Tauri and wry rewriting the
/// window's styles, so it is re-asserted on every show and by the supervisor.
///
/// Returns whether the flag is in place afterwards.
#[cfg(windows)]
fn ensure_topmost(w: &tauri::WebviewWindow<tauri::Wry>) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    let Ok(hwnd) = w.hwnd() else {
        return false;
    };
    let hwnd = HWND(hwnd.0 as *mut _);
    unsafe {
        SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .is_ok()
    }
}

#[cfg(not(windows))]
fn ensure_topmost(_w: &tauri::WebviewWindow<tauri::Wry>) -> bool {
    true
}

/// Keeps `WS_EX_NOACTIVATE` on the overlay, so showing the pill can never pull
/// keyboard focus away from the app being dictated into - which is what breaks
/// the paste at the end of the recording.
///
/// Returns whether the style is in place afterwards. It is applied at build
/// time and re-asserted on every show and by the supervisor, because the OS
/// window style is not ours alone: Tauri and wry write `GWL_EXSTYLE` too.
#[cfg(windows)]
fn ensure_no_activate(w: &tauri::WebviewWindow<tauri::Wry>) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    let Ok(hwnd) = w.hwnd() else {
        return false;
    };
    let hwnd = HWND(hwnd.0 as *mut _);
    let bit = WS_EX_NOACTIVATE.0 as isize;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        if style & bit != 0 {
            return true;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | bit);
        GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & bit != 0
    }
}

#[cfg(not(windows))]
fn ensure_no_activate(_w: &tauri::WebviewWindow<tauri::Wry>) -> bool {
    true
}

/// The supervisor's judgement: is the pill's window able to draw right now?
///
/// Healthy means both clocks are fresh. Unhealthy means a repair, escalating
/// from a page reload (which respawns a crashed renderer and re-runs the page)
/// to rebuilding the window outright - the case that used to mean "quit the
/// app and start it again". Each rung is given a grace period, and repeating
/// failures are spaced further apart, so a renderer that cannot be revived
/// costs a rebuild every half minute rather than a reload loop.
fn ensure_overlay_healthy(app: &AppHandle) {
    let now = Instant::now();
    let reason = {
        let state = app.state::<AppState>();
        let watch = state.overlay_watch.lock().unwrap();
        let frame_bad = watch
            .frame
            .map_or(true, |t| now.duration_since(t) > OVERLAY_FRAME_STALE);
        let poll_bad = watch
            .poll
            .map_or(true, |t| now.duration_since(t) > OVERLAY_POLL_STALE);
        match (frame_bad, poll_bad) {
            (false, false) => None,
            (true, false) => Some("its page is not producing frames"),
            (false, true) => Some("its page stopped pulling the recording state"),
            (true, true) => Some("its page stopped answering"),
        }
    };

    let Some(reason) = reason else {
        // Back to the cheapest rung for whatever happens next. The lock is
        // dropped before anything is written: this command's clocks are read
        // 25 times a second by the page, and file I/O has no business inside
        // that path.
        let was_healing = {
            let state = app.state::<AppState>();
            let mut watch = state.overlay_watch.lock().unwrap();
            let was_healing = watch.stage != 0;
            watch.stage = 0;
            watch.healed_at = None;
            was_healing
        };
        if was_healing {
            logs::diag("the overlay is drawing again");
        }
        return;
    };

    let step = {
        let state = app.state::<AppState>();
        let mut watch = state.overlay_watch.lock().unwrap();
        // Space repairs further apart as they keep failing.
        let patience = OVERLAY_HEAL_GRACE * (1 + u32::from(watch.stage.min(4)));
        if watch
            .healed_at
            .map_or(false, |t| now.duration_since(t) < patience)
        {
            return;
        }
        watch.stage = watch.stage.saturating_add(1);
        watch.healed_at = Some(now);
        watch.stage
    };

    logs::diag(&format!(
        "overlay unhealthy ({reason}); repair step {step}"
    ));

    if step == 1 {
        // Cheapest rung, and the only one the user cannot see: a reload
        // respawns a dead renderer and re-runs the page in place.
        if let Some(w) = app.get_webview_window("overlay") {
            let _ = w.eval("location.reload()");
        }
        return;
    }

    if step == 2 {
        emit_warning(
            app,
            "The recording indicator stopped drawing and was rebuilt - no restart needed. \
             The details are in the overlay log."
                .to_string(),
        );
    }

    // A reload did not bring it back, so the window itself is rebuilt.
    if let Some(w) = app.get_webview_window("overlay") {
        // `destroy`, not `close`: the close-requested handler hides windows,
        // which would leave the "overlay" label taken and the rebuild failing.
        let _ = w.destroy();
    }
    let task = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = build_overlay(&task) {
            emit_error(
                &task,
                format!("could not rebuild the recording indicator: {e}"),
            );
        }
    });
}

/// The overlay's supervisor: keeps its window where it belongs, keeps it
/// unable to steal focus, and revives it if its page has gone quiet. This is
/// what turns "quit the app and start it again" into "it fixed itself".
fn spawn_overlay_watchdog(app: AppHandle) {
    std::thread::spawn(move || {
        // A cold start needs a moment before its page can be judged.
        std::thread::sleep(Duration::from_secs(10));
        loop {
            place_overlay(&app);
            if let Some(w) = app.get_webview_window("overlay") {
                let _ = ensure_no_activate(&w);
                let _ = ensure_topmost(&w);
            }
            ensure_overlay_healthy(&app);
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

/// The whisper-style caption window: a small pill at the bottom of the screen
/// that appears while the mic is live, so it is obvious from anywhere that
/// recording is happening. Click-through, and not in the taskbar.
///
/// The window is a transparent surface larger than the pill itself. The
/// margin gives the outer glow room to render, and the pill's rounded corners
/// come from CSS anti-aliasing instead of a Win32 region clip, which drew
/// hard stair-stepped edges users could see. The window stays on screen for
/// the whole session and the pill is hidden by not drawing it, so the
/// renderer is never suspended and never occluded - see `set_overlay_visible`
/// for why that matters. Called again, on the main thread, when the
/// supervisor has to rebuild a window whose renderer will not come back.
fn build_overlay(app: &AppHandle) -> tauri::Result<()> {
    let overlay = tauri::WebviewWindowBuilder::new(
        app,
        "overlay",
        tauri::WebviewUrl::App("index.html#overlay".into()),
    )
    .title("nutq")
    // Pill (236x46) centered inside a transparent margin, so even the widest
    // glow setting never clips at the window edge.
    .inner_size(296.0, 106.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .visible(false)
    .build()?;

    // Clicks pass through: the pill is a display, not a control, and a click
    // on it must not move focus either.
    let _ = overlay.set_ignore_cursor_events(true);

    // Show it and put it where it belongs - on screen, at the pill's spot,
    // for the rest of the app's life. It is never hidden and never parked out
    // of sight: Chromium treats a window whose pixels all sit outside every
    // monitor as occluded and stops drawing it, and hiding a WebView2 window
    // suspends the renderer. Either one leaves the pill unable to appear.
    // Built hidden so the show below happens after the window exists and can
    // be taken out of the activation chain in the same breath.
    let _ = overlay.show();
    let _ = overlay.as_ref().show();
    place_overlay(app);

    // Last of the window calls: Tauri re-applies its own extended style on
    // window updates, so a bit set before them can be wiped.
    if !ensure_no_activate(&overlay) {
        logs::diag("the overlay could not be marked no-activate at build time");
    }
    if !ensure_topmost(&overlay) {
        logs::diag("the overlay could not be raised topmost at build time");
    }

    logs::diag("overlay window built");

    Ok(())
}

/// Fans the capture thread's live loudness value out to the overlay ~30 times
/// a second while recording. Emitted from this side thread rather than the
/// audio callback, where serialization work would be unwelcome.
fn spawn_level_ticker(app: AppHandle) {
    let level = app.state::<AppState>().recorder.level_handle();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(33));
        if app.state::<AppState>().status() == Status::Recording {
            let v = f32::from_bits(level.load(std::sync::atomic::Ordering::Relaxed));
            let _ = app.emit("level", v);
        }
    });
}

// `Emitter::emit` clones the payload once per listening window.
#[derive(Clone, Serialize)]
struct ResultPayload {
    raw: String,
    refined: String,
    mode: Mode,
    output: Output,
    seconds: f32,
    cost_usd: f64,
}

#[derive(Serialize)]
struct Usage {
    month_cost: f64,
    month_count: usize,
    /// Dictations finished today and the audio they carried, which is the
    /// figure a refilling provider allowance cannot report.
    today_count: usize,
    today_audio_seconds: f32,
    /// False when either selected provider publishes no rate we can apply, so
    /// the UI can say the figure is partial instead of implying it is the bill.
    cost_complete: bool,
}

// ---------------------------------------------------------------- commands

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn update_settings(app: AppHandle, state: State<AppState>, next: Settings) -> Result<(), String> {
    // Refuse a hotkey that cannot work instead of saving it and going deaf.
    // Saving first was how a single unusable spec could take out BOTH keys:
    // the bad one never bound, and the good one it replaced was already gone.
    for (i, p) in next.profiles.iter().enumerate() {
        parse_hotkey(&p.hotkey)
            .map_err(|e| format!("Line {} ({}): {e}", i + 1, p.name))?;
    }

    let hotkeys_changed = {
        let current = state.settings.lock().unwrap();
        current.profiles != next.profiles
    };

    save_settings(&next).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = next;

    if hotkeys_changed {
        register_hotkeys(&app).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_api_key(provider: String, key: String) -> Result<(), String> {
    settings::set_api_key(&provider, &key).map_err(|e| e.to_string())
}

/// Which credential slots are filled. The UI decides what is *required* from
/// the selected providers, so this just reports what exists.
#[tauri::command]
fn key_status() -> serde_json::Map<String, serde_json::Value> {
    ALL_PROVIDERS
        .iter()
        .map(|p| ((*p).to_string(), serde_json::Value::Bool(has_api_key(p))))
        .collect()
}

/// Validates a spec without registering it, so the Settings field can reject a
/// key at the moment it is pressed rather than at the moment it is needed.
#[tauri::command]
fn check_hotkey(spec: String) -> Result<(), String> {
    parse_hotkey(&spec).map(|_| ())
}

/// What each line's binding is currently doing. The Settings page asks on
/// load, because the answer is decided during setup - before any window
/// exists to be told about it.
#[tauri::command]
fn hotkey_status(state: State<AppState>) -> Vec<HotkeySlot> {
    state.hotkey_report.lock().unwrap().clone()
}

#[tauri::command]
fn list_microphones() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn get_history(state: State<AppState>) -> Vec<HistoryEntry> {
    state.history.lock().unwrap().entries.clone()
}

/// The newest history entry, or none on a fresh install.
///
/// The home page shows the last result from here rather than from the `result`
/// event, so it carries the same detail as a history row - which model and
/// which microphone produced it - and is still there after a restart, when no
/// event will ever arrive. Cheap enough to poll; the full list is not.
#[tauri::command]
fn get_latest(state: State<AppState>) -> Option<HistoryEntry> {
    state.history.lock().unwrap().entries.first().cloned()
}

#[tauri::command]
fn clear_history(state: State<AppState>) -> Result<(), String> {
    clips::clear();
    let mut h = state.history.lock().unwrap();
    h.entries.clear();
    save_history(&h).map_err(|e| e.to_string())
}

/// Removes one entry and its recording. `clear_history` is a blunt instrument
/// for a single bad result, so the list offers this per entry instead.
#[tauri::command]
fn delete_history_entry(state: State<AppState>, id: String) -> Result<(), String> {
    let mut h = state.history.lock().unwrap();
    let audio_file = match h.entries.iter().position(|e| e.id == id) {
        Some(i) => h.entries.remove(i).audio_file,
        None => return Ok(()),
    };
    if let Some(name) = audio_file {
        clips::remove(&name);
    }
    save_history(&h).map_err(|e| e.to_string())
}

/// One model's share of a usage bucket: the entries its STT model actually
/// transcribed. Entries old enough to predate model tracking carry an empty
/// stt_model and land in a single "unknown" slice.
#[derive(Serialize)]
struct UsageSlice {
    model: String,
    count: usize,
    seconds: f32,
}

/// One bar of the usage chart.
#[derive(Serialize)]
struct UsageBucket {
    /// "YYYY-MM-DD" for the day ranges, "HH:00" for the hour-by-hour
    /// breakdown of the Day range.
    label: String,
    /// Dictations finished in this bucket.
    count: usize,
    /// Seconds of audio they carried.
    seconds: f32,
    /// The same two numbers split per STT model, so the chart can draw one
    /// colored segment per model inside each bar.
    models: Vec<UsageSlice>,
}

/// The slice name an entry files under: the model that transcribed it, or
/// "unknown" when the entry predates model tracking.
fn slice_model(e: &HistoryEntry) -> &str {
    if e.stt_model.is_empty() {
        "unknown"
    } else {
        e.stt_model.as_str()
    }
}

/// Folds one bucket's per-model map into a bar: the slices in a stable
/// (alphabetical) order, plus the totals they add up to.
fn usage_bucket(
    label: String,
    models: &std::collections::BTreeMap<String, (usize, f32)>,
) -> UsageBucket {
    let mut count = 0;
    let mut seconds = 0.0;
    let mut slices = Vec::with_capacity(models.len());
    for (model, (c, s)) in models {
        count += c;
        seconds += s;
        slices.push(UsageSlice {
            model: model.clone(),
            count: *c,
            seconds: *s,
        });
    }
    UsageBucket {
        label,
        count,
        seconds,
        models: slices,
    }
}

/// Usage buckets for the History page's chart. `range` is one of the chart's
/// four filters: "day" breaks today down hour by hour into 24 buckets, and
/// the others are trailing windows of whole days ending today. Empty buckets
/// are included so gaps read as gaps rather than ending the chart early.
/// Each bucket also carries its per-STT-model split, which the chart stacks
/// as one colored segment per model.
#[tauri::command]
fn get_history_stats(state: State<AppState>, range: String) -> Vec<UsageBucket> {
    let h = state.history.lock().unwrap();

    if range == "day" {
        let today_prefix = chrono::Local::now().format("%Y-%m-%d").to_string();
        let mut hours: Vec<std::collections::BTreeMap<String, (usize, f32)>> =
            vec![std::collections::BTreeMap::new(); 24];
        for e in &h.entries {
            if !e.at.starts_with(&today_prefix) || e.at.len() < 13 {
                continue;
            }
            if let Ok(hr) = e.at[11..13].parse::<usize>() {
                if hr < 24 {
                    let slot = hours[hr]
                        .entry(slice_model(e).to_string())
                        .or_insert((0, 0.0));
                    slot.0 += 1;
                    slot.1 += e.seconds;
                }
            }
        }
        return hours
            .iter()
            .enumerate()
            .map(|(i, m)| usage_bucket(format!("{i:02}:00"), m))
            .collect();
    }

    let days = match range.as_str() {
        "week" => 7,
        "month" => 30,
        _ => 90,
    };

    let mut by_day: std::collections::BTreeMap<
        String,
        std::collections::BTreeMap<String, (usize, f32)>,
    > = std::collections::BTreeMap::new();
    for e in &h.entries {
        let day = e.at.get(..10).unwrap_or_default().to_string();
        let slot = by_day
            .entry(day)
            .or_default()
            .entry(slice_model(e).to_string())
            .or_insert((0, 0.0));
        slot.0 += 1;
        slot.1 += e.seconds;
    }
    drop(h);

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let Some(end) = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").ok() else {
        return Vec::new();
    };
    let mut cursor = end - chrono::Duration::days(days as i64 - 1);

    let mut out = Vec::new();
    loop {
        let key = cursor.format("%Y-%m-%d").to_string();
        let empty = std::collections::BTreeMap::new();
        let models = by_day.get(&key).unwrap_or(&empty);
        out.push(usage_bucket(key, models));
        if cursor >= end {
            break;
        }
        cursor += chrono::Duration::days(1);
    }
    out
}

/// The kept recording for one history entry, base64-encoded so the webview can
/// hand it straight to an `<audio>` element. A byte array over the command
/// bridge would be serialized as a JSON array of numbers - roughly ten times
/// the size for the same audio.
#[tauri::command]
fn get_history_audio(state: State<AppState>, id: String) -> Result<String, String> {
    let name = {
        let h = state.history.lock().unwrap();
        h.entries
            .iter()
            .find(|e| e.id == id)
            .and_then(|e| e.audio_file.clone())
            .ok_or("this entry has no saved audio")?
    };
    let bytes = clips::read(&name).map_err(|e| format!("{e:#}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// What each provider last said about the allowance left on the key.
///
/// Read from the reply headers of calls the app already makes, so it costs no
/// extra request and needs no access to the key itself. Empty until the first
/// call of a session - there is nothing to report before a provider has
/// answered once.
#[tauri::command]
fn get_quota() -> Vec<net::Quota> {
    net::quotas()
}

/// The persistent warning/error log, newest first.
#[tauri::command]
fn get_logs() -> Vec<logs::LogEntry> {
    logs::list()
}

#[tauri::command]
fn clear_logs() {
    logs::clear();
}

#[tauri::command]
fn get_usage(state: State<AppState>) -> Usage {    let h = state.history.lock().unwrap();
    let cfg = state.settings.lock().unwrap();
    let (today_count, today_audio_seconds) = h.today_totals();
    Usage {
        month_cost: h.month_total(),
        month_count: h.month_count(),
        today_count,
        today_audio_seconds,
        cost_complete: cfg.stt_provider.cost_tracked()
            && (!cfg.refine_enabled || cfg.refine_provider.cost_tracked()),
    }
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    inject::copy_only(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_status(state: State<AppState>) -> Status {
    state.status()
}

/// Asks the selected provider which models it offers for this key, so a
/// retired model name (Gemini 2.5 for new accounts, say) is visible here
/// instead of showing up as a 404 mid-dictation.
#[tauri::command]
async fn list_models(app: AppHandle, stage: String) -> Result<Vec<String>, String> {
    let cfg = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.clone()
    };

    let work = async {
        match stage.as_str() {
            "stt" => discover::for_stt(&get_api_key(cfg.stt_provider.key_slot())?, &cfg).await,
            "refine" => {
                discover::for_refine(&get_api_key(cfg.refine_provider.key_slot())?, &cfg).await
            }
            other => Err(anyhow::anyhow!("unknown stage: {other}")),
        }
    };

    match tokio::time::timeout(net::TEST_TIMEOUT, work).await {
        Ok(Ok(models)) => Ok(models),
        Ok(Err(e)) => Err(format!("{e:#}")),
        Err(_) => Err("Timed out asking the provider for its model list.".into()),
    }
}

#[derive(Serialize)]
struct TestResult {
    ok: bool,
    message: String,
}

/// Runs one real request against the selected provider for a stage, so a
/// misconfiguration is caught here - with a message saying which of the URL,
/// the key, or the model is at fault - instead of mid-dictation.
#[tauri::command]
async fn test_provider(app: AppHandle, stage: String) -> TestResult {
    let cfg = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.clone()
    };

    let probe = async {
        match stage.as_str() {
            "stt" => stt::test(&get_api_key(cfg.stt_provider.key_slot())?, &cfg).await,
            "refine" => refine::test(&get_api_key(cfg.refine_provider.key_slot())?, &cfg).await,
            other => Err(anyhow::anyhow!("unknown stage: {other}")),
        }
    };

    let outcome = match tokio::time::timeout(net::TEST_TIMEOUT, probe).await {
        Ok(r) => r,
        Err(_) => Err(anyhow::anyhow!(
            "The test timed out after {} seconds with no reply. The endpoint is unreachable, \
             very slow, or being blocked before it can answer.",
            net::TEST_TIMEOUT.as_secs()
        )),
    };

    match outcome {
        Ok(message) => TestResult { ok: true, message },
        Err(e) => TestResult {
            ok: false,
            // `{:#}` prints the whole anyhow chain, not just the outermost
            // message, so a nested cause is not silently dropped.
            message: format!("{e:#}"),
        },
    }
}

/// Same entry point the hotkey uses, so the on-screen button and the shortcut
/// can never drift apart. `profile` is a line id; absent or unknown falls
/// back to the first line.
#[tauri::command]
fn toggle(app: AppHandle, profile: Option<String>) {
    let state = app.state::<AppState>();
    let id = {
        let s = state.settings.lock().unwrap();
        s.profile(&profile.unwrap_or_default()).id
    };
    toggle_recording(&app, &id);
}

// ---------------------------------------------------------------- pipeline

/// One provider attempt per stage, so the failover wrappers can swap the
/// provider/model and call the exact same code the primary path uses.
async fn run_stt(
    cfg: &Settings,
    wav: &[u8],
    retries: u32,
    timeout: Duration,
) -> anyhow::Result<stt::Transcript> {
    let key = get_api_key(cfg.stt_provider.key_slot())?;
    stt::transcribe(&key, cfg, &modes::transcription_prompt(cfg), wav, retries, timeout).await
}

async fn run_refine(
    cfg: &Settings,
    transcript: &str,
    retries: u32,
) -> anyhow::Result<refine::Refined> {
    let key = get_api_key(cfg.refine_provider.key_slot())?;
    refine::refine(&key, cfg, &modes::system_prompt(cfg), transcript, retries).await
}

/// How long the primary provider is allowed to keep retrying a rate limit.
///
/// With a backup configured, waiting out the primary's 429 is strictly slower
/// than just asking the backup - so the primary gets one attempt and the
/// failover does the rest. With no backup there is nowhere else to go, and the
/// full ladder is what turns a transient throttle into a result.
fn primary_retries(has_backup: bool) -> u32 {
    if has_backup {
        net::FAILOVER_RETRIES
    } else {
        net::MAX_RATE_LIMIT_RETRIES
    }
}

/// Primary provider first; on failure, the configured backup gets the exact
/// same audio before the caller sees an error. Returns the result plus
/// whether the backup produced it, so history can say who did the work.
async fn transcribe_with_failover(
    app: &AppHandle,
    cfg: &Settings,
    wav: &[u8],
) -> anyhow::Result<(stt::Transcript, bool)> {
    let has_backup = cfg.stt_backup_enabled;
    match run_stt(
        cfg,
        wav,
        primary_retries(has_backup),
        // With a backup waiting, fail a dead primary fast - the full timeout
        // here would read as the app hanging on "Transcribing" when the
        // provider that will actually answer hasn't been asked yet.
        if has_backup {
            net::FAILOVER_TIMEOUT
        } else {
            net::REQUEST_TIMEOUT
        },
    )
    .await
    {
        Ok(t) => Ok((t, false)),
        Err(primary) => {
            if !has_backup {
                return Err(primary);
            }
            eprintln!("[nutq] stt primary failed, trying backup: {primary:#}");
            emit_warning(
                app,
                format!("Transcription failed, trying the backup provider: {primary:#}"),
            );
            // The backup is the last chance, so it gets the full retry ladder
            // and the full request timeout.
            match run_stt(
                &stt_backup_cfg(cfg),
                wav,
                net::MAX_RATE_LIMIT_RETRIES,
                net::REQUEST_TIMEOUT,
            )
            .await
            {
                Ok(t) => Ok((t, true)),
                Err(backup) => Err(anyhow::anyhow!(
                    "primary: {primary:#} | backup: {backup:#}"
                )),
            }
        }
    }
}

async fn refine_with_failover(
    app: &AppHandle,
    cfg: &Settings,
    transcript: &str,
) -> anyhow::Result<(refine::Refined, bool)> {
    match run_refine(cfg, transcript, primary_retries(cfg.refine_backup_enabled)).await {
        Ok(r) => Ok((r, false)),
        Err(primary) => {
            if !cfg.refine_backup_enabled {
                return Err(primary);
            }
            eprintln!("[nutq] refine primary failed, trying backup: {primary:#}");
            emit_warning(
                app,
                format!("Refinement failed, trying the backup provider: {primary:#}"),
            );
            // Last chance, so the full retry ladder applies here.
            match run_refine(&refine_backup_cfg(cfg), transcript, net::MAX_RATE_LIMIT_RETRIES)
                .await
            {
                Ok(r) => Ok((r, true)),
                Err(backup) => Err(anyhow::anyhow!(
                    "primary: {primary:#} | backup: {backup:#}"
                )),
            }
        }
    }
}

fn stt_backup_cfg(cfg: &Settings) -> Settings {
    let mut c = cfg.clone();
    c.stt_provider = cfg.stt_backup_provider;
    c.stt_model = cfg.stt_backup_model.clone();
    c
}

fn refine_backup_cfg(cfg: &Settings) -> Settings {
    let mut c = cfg.clone();
    c.refine_provider = cfg.refine_backup_provider;
    c.refine_model = cfg.refine_backup_model.clone();
    c
}

fn now_id() -> String {
    format!("{}", chrono::Local::now().timestamp_millis())
}

fn now_str() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Files a finished dictation on the Notes page and tells the UI. The
/// note's kind follows the line's processing mode, so a Notes-line note is
/// cleaned text and an Ideas-line note is a developed idea - no separate
/// picker to lie about.
fn file_note(app: &AppHandle, profile: &Profile, mode: Mode, text: &str) {
    let kind = notes::NoteKind::from_mode(&mode);
    if let Err(e) = notes::add(&now_id(), &now_str(), kind, &profile.name, text) {
        eprintln!("[nutq] could not file the note: {e:#}");
    }
    let _ = app.emit("notes-changed", ());
}

/// The one way warnings reach the user: shown as a toast, and filed in the
/// persistent log. The toast is easy to miss or dismiss; the log is the
/// record the Logs page reads.
fn emit_warning(app: &AppHandle, message: String) {
    logs::add("warning", &message);
    let _ = app.emit("warning", message);
}

/// Same for errors. They were already persistent in the UI, but nothing
/// survived a restart before the log existed.
fn emit_error(app: &AppHandle, message: String) {
    logs::add("error", &message);
    let _ = app.emit("error", message);
}

/// Parks a failed job for retry and tells the UI the list changed.
fn park(app: &AppHandle, entry: pending::PendingEntry, wav: Option<&[u8]>) {
    if let Err(e) = pending::add(entry, wav) {
        emit_warning(
            app,
            format!("could not save the failed job for retry: {e:#}"),
        );
        return;
    }
    let _ = app.emit("pending-changed", ());
}

fn toggle_recording(app: &AppHandle, profile_id: &str) {
    let state = app.state::<AppState>();

    match state.status() {
        Status::Idle => {
            // The line's identity is fixed at start; its output and the rest
            // of the configuration are read from it when the pipeline runs.
            let mic = {
                let s = state.settings.lock().unwrap();
                let p = s.profile(profile_id);
                *state.pending_profile.lock().unwrap() = p.id.clone();
                s.microphone.clone()
            };
            match state.recorder.start(Some(mic)) {
                Ok(()) => {
                    *state.pending_mic.lock().unwrap() = state.recorder.current_device();
                    state.set_status(app, Status::Recording);
                    arm_escape(app);
                }
                Err(e) => {
                    *state.pending_profile.lock().unwrap() = String::new();
                    eprintln!("[nutq] start failed: {e:#}");
                    emit_error(app, audio::friendly_error(&e));
                }
            }
        }
        Status::Recording => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = process(&app).await {
                    let state = app.state::<AppState>();
                    state.set_status(&app, Status::Idle);
                    emit_error(&app, e.to_string());
                }
            });
        }
        // Already working on the previous clip - ignore the press rather than
        // interleave two pipelines.
        _ => {}
    }
}

/// Escape pressed while the mic is live: throw the capture away. No
/// transcription, no history row, no paste, no cost - the recording simply
/// never happened, and nothing announces it (a cancelled dictation is the
/// user's own "never mind", not an event worth interrupting them for).
fn cancel_recording(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.status() != Status::Recording {
        return;
    }
    disarm_escape(app);
    match state.recorder.cancel() {
        Ok(()) => {
            state.set_status(app, Status::Idle);
            eprintln!("[nutq] recording cancelled with Escape - audio discarded");
        }
        Err(e) => {
            eprintln!("[nutq] cancel failed: {e:#}");
            state.set_status(app, Status::Idle);
            emit_error(app, audio::friendly_error(&e));
        }
    }
}

async fn process(app: &AppHandle) -> anyhow::Result<()> {
    let state = app.state::<AppState>();

    // The recording ended the moment stop() runs below, so Escape goes back
    // to being a normal key whatever this function goes on to do.
    disarm_escape(app);

    // A clip with no speech in it is dropped here, before anything is uploaded:
    // no API call, no cost, no history row, and - the point of the exercise -
    // no invented sentence pasted into whatever the user was typing in.
    let wav = match state.recorder.stop()? {
        audio::Capture::Ready(wav) => wav,
        audio::Capture::Silent => {
            state.set_status(app, Status::Idle);
            emit_warning(
                app,
                "Nothing was heard, so nothing was sent. If you did speak, check that the                  right microphone is selected in Settings and that it is not muted."
                    .to_string(),
            );
            return Ok(());
        }
        audio::Capture::TooShort(secs) => {
            state.set_status(app, Status::Idle);
            emit_warning(
                app,
                format!(
                    "That recording was only {secs:.1}s - too short to be speech, so it was                      discarded. Hold the hotkey session open a moment longer before ending it."
                ),
            );
            return Ok(());
        }
    };

    let seconds = audio::duration_seconds(wav.len());
    let profile_id = state.pending_profile.lock().unwrap().clone();
    let microphone = state.pending_mic.lock().unwrap().clone();

    // The line decides everything: its mode and prompt, its stage overrides
    // if it has any, and its output destination.
    let (profile, cfg) = {
        let s = state.settings.lock().unwrap();
        let p = s.profile(&profile_id);
        (p.clone(), s.effective(&p))
    };
    let profile_name = profile.name.clone();
    let output = profile.output;

    state.set_status(app, Status::Transcribing);
    let (transcript, stt_via_backup) = match transcribe_with_failover(app, &cfg, &wav).await {
        Ok(t) => t,
        Err(e) => {
            // Every provider refused the audio. Keep the recording so the
            // user can retry later - possibly with different providers.
            park(
                app,
                pending::PendingEntry {
                    id: now_id(),
                    created_at: now_str(),
                    stage: "transcription".into(),
                    error: format!("{e:#}"),
                    seconds,
                    mode: cfg.mode,
                    output,
                    microphone: microphone.clone(),
                    wav_file: None,
                    transcript: None,
                    profile_id: profile.id.clone(),
                },
                Some(&wav),
            );
            return Err(anyhow::anyhow!(
                "Transcription failed on every provider. The recording was saved - retry it \
                 from the Pending list on the Home page. ({e:#})"
            ));
        }
    };

    let mut cost = transcript.cost_usd;
    let mut final_text = transcript.text.clone();
    let mut refine_model_used = String::new();
    let mut refine_via_backup = false;

    if cfg.refine_enabled {
        state.set_status(app, Status::Refining);
        match refine_with_failover(app, &cfg, &transcript.text).await {
            Ok((refined, via_backup)) => {
                cost += refined.cost_usd;
                final_text = refined.text;
                refine_model_used = if via_backup {
                    cfg.refine_backup_model.clone()
                } else {
                    cfg.refine_model.clone()
                };
                refine_via_backup = via_backup;
            }
            // The transcript is the valuable part and it already succeeded.
            // Paste it now, and park the refinement so it can be redone once
            // a provider is reachable again.
            Err(e) => {
                park(
                    app,
                    pending::PendingEntry {
                        id: now_id(),
                        created_at: now_str(),
                        stage: "refinement".into(),
                        error: format!("{e:#}"),
                        seconds,
                        mode: cfg.mode,
                        output,
                        microphone: microphone.clone(),
                        wav_file: None,
                        transcript: Some(transcript.text.clone()),
                        profile_id: profile.id.clone(),
                    },
                    None,
                );
                emit_warning(
                    app,
                    format!(
                        "Refinement failed on every provider - the raw transcript was used, \
                         and the job was saved to Pending for a retry. ({e:#})"
                    ),
                );
            }
        }
    }

    state.set_status(app, Status::Idle);

    {
        let id = now_id();
        // The clip is written before the entry so an entry never points at a
        // file that failed to appear; a failed write just means no playback.
        let audio_file = if cfg.save_audio {
            match clips::save(&id, &wav) {
                Ok(name) => Some(name),
                Err(e) => {
                    eprintln!("[nutq] could not keep the recording: {e:#}");
                    None
                }
            }
        } else {
            None
        };

        let mut h = state.history.lock().unwrap();
        h.push(HistoryEntry {
            id,
            at: now_str(),
            mode: cfg.mode,
            raw: transcript.text,
            refined: final_text.clone(),
            seconds,
            cost_usd: cost,
            stt_model: if stt_via_backup {
                cfg.stt_backup_model.clone()
            } else {
                cfg.stt_model.clone()
            },
            stt_via_backup,
            refine_model: refine_model_used,
            refine_via_backup,
            microphone,
            audio_file,
            profile: profile_name,
            profile_id: profile.id.clone(),
        });
        clips::enforce_cap(&mut h);
        let _ = save_history(&h);
    }

    // A checklist line's result is pasted like any other, but it is also
    // parsed into tickable items so the To-do page has it. The paste and the
    // filing share one text, so they can never disagree.
    if cfg.mode == Mode::Checklist {
        let id = now_id();
        if let Err(e) = todos::add_from_text(&id, &now_str(), &final_text) {
            eprintln!("[nutq] could not file the checklist: {e:#}");
        }
        let _ = app.emit("todos-changed", ());
    }

    let _ = app.emit(
        "result",
        ResultPayload {
            raw: String::new(),
            refined: final_text.clone(),
            mode: cfg.mode,
            output,
            seconds,
            cost_usd: cost,
        },
    );

    match output {
        Output::Instant => inject::paste(&final_text)?,
        Output::Notes => {
            // Filed on the Notes page, and copied so the text is still one
            // keystroke away from wherever the user happens to be.
            file_note(app, &profile, cfg.mode, &final_text);
            inject::copy_only(&final_text)?;
        }
        Output::Draft => {
            inject::copy_only(&final_text)?;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }

    Ok(())
}

/// Re-runs a parked job with the CURRENT settings - whichever provider is
/// selected now, plus its backup - and only removes it on success.
#[tauri::command]
async fn retry_pending(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.status() != Status::Idle {
        return Err("wait for the current dictation to finish first".into());
    }

    let entry = pending::get(&id).ok_or("this job is no longer pending")?;

    // The retry runs under the line the job came from - its overrides, its
    // mode - falling back to the globals for a job that predates lines.
    let (profile, cfg) = {
        let s = state.settings.lock().unwrap();
        let p = s.profile(&entry.profile_id);
        (p.clone(), s.effective(&p))
    };

    // Held so a successful retry can keep the audio in history, the same way a
    // first-try dictation does. A stage-2 retry has no wav left to keep.
    let mut wav_bytes: Option<Vec<u8>> = None;

    let transcript_text = if let Some(t) = entry.transcript.clone() {
        t
    } else {
        state.set_status(&app, Status::Transcribing);
        let wav = pending::read_wav(&id).map_err(|e| e.to_string())?;
        let result = transcribe_with_failover(&app, &cfg, &wav).await;
        wav_bytes = Some(wav);
        match result {
            Ok((t, _)) => t.text,
            Err(e) => {
                state.set_status(&app, Status::Idle);
                let _ = pending::update_error(&id, &format!("{e:#}"));
                return Err(format!("still failing, the job stays pending: {e:#}"));
            }
        }
    };

    let mut final_text = transcript_text.clone();
    let mut cost = 0.0;

    if cfg.refine_enabled {
        state.set_status(&app, Status::Refining);
        match refine_with_failover(&app, &cfg, &transcript_text).await {
            Ok((r, _)) => {
                cost += r.cost_usd;
                final_text = r.text;
            }
            Err(e) => {
                state.set_status(&app, Status::Idle);
                // The audio part now succeeded, so upgrade the job: next
                // retry starts from the transcript instead of the wav.
                let _ = if entry.transcript.is_some() {
                    pending::update_error(&id, &format!("{e:#}"))
                } else {
                    pending::promote_to_refinement(&id, &transcript_text, &format!("{e:#}"))
                };
                let _ = app.emit("pending-changed", ());
                return Err(format!("refinement failed again, kept pending: {e:#}"));
            }
        }
    }

    state.set_status(&app, Status::Idle);
    let _ = pending::remove(&id);
    let _ = app.emit("pending-changed", ());

    {
        let hist_id = now_id();
        let audio_file = match (cfg.save_audio, &wav_bytes) {
            (true, Some(wav)) => clips::save(&hist_id, wav).ok(),
            _ => None,
        };

        let mut h = state.history.lock().unwrap();
        h.push(HistoryEntry {
            id: hist_id,
            at: now_str(),
            mode: entry.mode,
            raw: transcript_text.clone(),
            refined: final_text.clone(),
            seconds: entry.seconds,
            cost_usd: cost,
            stt_model: String::new(),
            stt_via_backup: false,
            refine_model: String::new(),
            refine_via_backup: false,
            microphone: entry.microphone.clone(),
            audio_file,
            profile: profile.name.clone(),
            profile_id: profile.id.clone(),
        });
        clips::enforce_cap(&mut h);
        let _ = save_history(&h);
    }

    if cfg.mode == Mode::Checklist {
        let tid = now_id();
        if let Err(e) = todos::add_from_text(&tid, &now_str(), &final_text) {
            eprintln!("[nutq] could not file the checklist: {e:#}");
        }
        let _ = app.emit("todos-changed", ());
    }

    let _ = app.emit(
        "result",
        ResultPayload {
            raw: String::new(),
            refined: final_text.clone(),
            mode: entry.mode,
            output: entry.output,
            seconds: entry.seconds,
            cost_usd: cost,
        },
    );

    match entry.output {
        Output::Instant => inject::paste(&final_text).map_err(|e| e.to_string())?,
        Output::Notes => {
            file_note(&app, &profile, entry.mode, &final_text);
            inject::copy_only(&final_text).map_err(|e| e.to_string())?;
        }
        Output::Draft => {
            inject::copy_only(&final_text).map_err(|e| e.to_string())?;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_pending() -> Vec<pending::PendingEntry> {
    pending::list()
}

/// Re-runs a saved entry through the CURRENT providers and updates it in
/// place - same id, same place in the list, new text. When the entry's
/// recording is still on disk the WHOLE pipeline runs again (audio ->
/// transcript -> finished text, so a bad transcription is fixable too);
/// when the audio has aged out past the 100-clip cap, stage 2 alone runs
/// over the saved raw transcript. Nothing is pasted anywhere; the History
/// page asked, and it gets the updated entry back as this command's return
/// value.
///
/// The entry keeps its own mode, so "regenerate" means "say the same thing
/// again, better" rather than reinterpreting it under today's mode. It runs
/// even when the polish toggle is off, because pressing the button IS the
/// ask - unlike a normal dictation, there is no ambiguity to respect.
#[tauri::command]
async fn regenerate_history_entry(app: AppHandle, id: String) -> Result<HistoryEntry, String> {
    let state = app.state::<AppState>();
    if state.status() != Status::Idle {
        return Err("wait for the current dictation to finish first".into());
    }

    let (mode, profile_id, mut raw, audio_file) = {
        let h = state.history.lock().unwrap();
        let e = h
            .entries
            .iter()
            .find(|e| e.id == id)
            .ok_or("this entry no longer exists")?;
        (
            e.mode,
            e.profile_id.clone(),
            e.raw.clone(),
            e.audio_file.clone(),
        )
    };

    // Under the line that produced the entry when it still exists, with the
    // entry's own mode winning either way: "say the same thing again, better"
    // must not silently change meaning because the line was re-pointed.
    let cfg = {
        let s = state.settings.lock().unwrap();
        let mut c = s.effective(&s.profile(&profile_id));
        c.mode = mode;
        c
    };

    let mut cost = 0.0f64;
    // Only overwritten when re-transcription actually ran; an audio-less
    // regeneration keeps the entry's original STT provenance.
    let mut new_stt: Option<(String, bool)> = None;

    if let Some(name) = audio_file {
        if let Ok(wav) = clips::read(&name) {
            state.set_status(&app, Status::Transcribing);
            match transcribe_with_failover(&app, &cfg, &wav).await {
                Ok((t, via_backup)) => {
                    cost += t.cost_usd;
                    raw = t.text;
                    new_stt = Some((
                        if via_backup {
                            cfg.stt_backup_model.clone()
                        } else {
                            cfg.stt_model.clone()
                        },
                        via_backup,
                    ));
                }
                Err(e) => {
                    state.set_status(&app, Status::Idle);
                    return Err(format!(
                        "regeneration failed, the entry is unchanged: {e:#}"
                    ));
                }
            }
        }
    }

    if raw.trim().is_empty() {
        state.set_status(&app, Status::Idle);
        return Err("this entry has no transcript to regenerate from".into());
    }

    state.set_status(&app, Status::Refining);
    let (r, via_backup) = match refine_with_failover(&app, &cfg, &raw).await {
        Ok(ok) => ok,
        Err(e) => {
            state.set_status(&app, Status::Idle);
            return Err(format!("regeneration failed, the entry is unchanged: {e:#}"));
        }
    };
    cost += r.cost_usd;
    state.set_status(&app, Status::Idle);

    let updated = {
        let mut h = state.history.lock().unwrap();
        let Some(e) = h.entries.iter_mut().find(|e| e.id == id) else {
            return Err("this entry no longer exists".into());
        };
        e.raw = raw;
        e.refined = r.text;
        e.cost_usd += cost;
        if let Some((model, stt_via_backup)) = new_stt {
            e.stt_model = model;
            e.stt_via_backup = stt_via_backup;
        }
        e.refine_model = if via_backup {
            cfg.refine_backup_model.clone()
        } else {
            cfg.refine_model.clone()
        };
        e.refine_via_backup = via_backup;
        let updated = e.clone();
        let _ = save_history(&h);
        updated
    };

    Ok(updated)
}

#[tauri::command]
fn discard_pending(app: AppHandle, id: String) -> Result<(), String> {
    pending::remove(&id).map_err(|e| e.to_string())?;
    let _ = app.emit("pending-changed", ());
    Ok(())
}

// ------------------------------------------------------------------ todos

/// The checklist line's output, newest list first.
#[tauri::command]
fn get_todos() -> Vec<todos::TodoList> {
    todos::list()
}

#[tauri::command]
fn toggle_todo(id: String, index: usize) -> Result<(), String> {
    todos::toggle(&id, index).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_todo_item(id: String, text: String) -> Result<(), String> {
    todos::add_item(&id, &text).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_todo_item(id: String, index: usize) -> Result<(), String> {
    todos::remove_item(&id, index).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_todo_list(id: String) -> Result<(), String> {
    todos::remove(&id).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ notes

/// The Notes page's contents, newest first.
#[tauri::command]
fn get_notes() -> Vec<notes::Note> {
    notes::list()
}

#[tauri::command]
fn update_note(id: String, text: String) -> Result<(), String> {
    notes::update(&id, &text).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_note_kind(id: String, kind: notes::NoteKind) -> Result<(), String> {
    notes::set_kind(&id, kind).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_note(id: String) -> Result<(), String> {
    notes::remove(&id).map_err(|e| e.to_string())
}

/// Diagnostics: the overlay page loaded and reports what it sees.
///
/// Also the first proof of life on the poll clock - a page that just (re)loaded
/// has run its JS and reached Rust. It deliberately does not touch the frame
/// clock: only a real animation frame may do that, or a page that loads and
/// then never composites would look healthy and never be repaired.
#[tauri::command]
fn overlay_alive(app: AppHandle, status: String) {
    let state = app.state::<AppState>();
    state.overlay_watch.lock().unwrap().poll = Some(Instant::now());
    logs::diag(&format!("the overlay page loaded; it sees status {status}"));
}

/// Proof that the pill's window is actually being composited.
///
/// The overlay page calls this from inside a `requestAnimationFrame` loop, so
/// a beat can only be sent while frames are being produced for the window. A
/// page whose compositor has stopped - the failure that left an invisible
/// pill on a transparent surface - stops beating, and Rust notices.
#[tauri::command]
fn overlay_frame(app: AppHandle) {
    let state = app.state::<AppState>();
    state.overlay_watch.lock().unwrap().frame = Some(Instant::now());
}

#[derive(Serialize, Clone)]
struct OverlayState {
    status: Status,
    /// Current mic RMS in [0, 1]; zero when not recording.
    level: f32,
    /// The pill's personalization, read fresh on every poll so a settings
    /// save lands on the very next frame without any event plumbing.
    style: String,
    glow_inner: bool,
    glow_outer: bool,
    aura_color: String,
    bg: String,
    /// Which line is recording, so the pill can say what the speech will
    /// become. Empty when idle.
    label: String,
}

/// One poll = everything the indicator needs. Event delivery to a hidden,
/// click-through webview turned out to be unreliable, so the overlay pulls
/// its state at ~25 Hz instead of waiting to be pushed.
#[tauri::command]
fn overlay_state(state: State<AppState>) -> OverlayState {
    // Every poll is also proof of life: the page reached Rust with its status
    // loop intact. The supervisor reads this clock alongside the frame one.
    state.overlay_watch.lock().unwrap().poll = Some(Instant::now());
    let s = state.settings.lock().unwrap();
    let recording = state.status() == Status::Recording;
    let label = if recording {
        s.profile(&state.pending_profile.lock().unwrap()).name
    } else {
        String::new()
    };
    OverlayState {
        status: state.status(),
        level: f32::from_bits(
            state
                .recorder
                .level_handle()
                .load(std::sync::atomic::Ordering::Relaxed),
        ),
        style: s.overlay_style.clone(),
        glow_inner: s.overlay_glow_inner,
        glow_outer: s.overlay_glow_outer,
        aura_color: s.overlay_aura_color.clone(),
        bg: s.overlay_bg.clone(),
        label,
    }
}

// ---------------------------------------------------------------- hotkeys

/// Turns a spec into a shortcut, with a message aimed at the person who typed
/// it rather than at the parser.
///
/// The plural spelling matters here: the parser splits on `+` before it looks
/// at anything, so a lone "+" is two empty tokens and can never mean the
/// numpad key. That key is "NumpadAdd", and there is no way to discover that
/// by typing - which is exactly why the Settings field records a keypress
/// instead of asking for a name.
fn parse_hotkey(spec: &str) -> Result<Shortcut, String> {
    let trimmed = spec.trim();
    if trimmed.is_empty() {
        return Err("No key is set.".into());
    }
    Shortcut::from_str(trimmed).map_err(|e| {
        let hint = if trimmed.contains("++") || trimmed.ends_with('+') || trimmed.starts_with('+') {
            " \"+\" is the separator between a modifier and a key, so it cannot name a key by              itself. The plus on the numeric keypad is \"NumpadAdd\"; click the field and press              the key to have it filled in correctly."
        } else {
            " Click the field and press the key you want, rather than typing its name."
        };
        format!("{e}{hint}")
    })
}

/// The Escape binding used as the mid-recording rescue key.
fn escape_shortcut() -> Shortcut {
    Shortcut::from_str("Escape").expect("Escape is a valid key name")
}

/// While the mic is live, Escape cancels the session outright: no
/// transcription, no history row, no paste, no cost. Without the binding the
/// keystroke would slip through to whatever app is being dictated into,
/// where it tends to close a dialog and take the dictation's destination
/// with it. It is registered for the length of the recording only. If the
/// user's own hotkey IS Escape, the normal handler already stops the
/// recording and there is nothing to arm.
fn arm_escape(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let task = app.clone();
        let _ = app.run_on_main_thread(move || arm_escape_now(&task));
    });
}

fn arm_escape_now(app: &AppHandle) {
    let state = app.state::<AppState>();
    let escape = escape_shortcut();
    if shortcut_in_use(app, &escape) {
        return;
    }
    if state.status() != Status::Recording {
        // A stale request caught up after the recording ended.
        return;
    }
    match app.global_shortcut().register(escape) {
        Ok(()) => *state.escape_armed.lock().unwrap() = true,
        Err(e) => eprintln!("[nutq] could not arm Escape as the save key: {e}"),
    }
}

/// The recording is over (or about to be): hand Escape back to the system.
/// Deferred for the same thread-affinity and re-entrancy reasons as
/// `arm_escape`: the register and unregister must happen on the main thread,
/// but never inside the plugin's own shortcut dispatch.
fn disarm_escape(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let task = app.clone();
        let _ = app.run_on_main_thread(move || disarm_escape_now(&task));
    });
}

fn disarm_escape_now(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.escape_armed.lock().unwrap() = false;
    let escape = escape_shortcut();
    if shortcut_in_use(app, &escape) {
        return;
    }
    let _ = app.global_shortcut().unregister(escape);
}

/// Whether one of the line bindings itself owns this shortcut - Escape as a
/// line's hotkey is the normal handler's job, and arming it on top would
/// make the same key both save and cancel.
fn shortcut_in_use(app: &AppHandle, shortcut: &Shortcut) -> bool {
    app.state::<AppState>()
        .shortcuts
        .lock()
        .unwrap()
        .iter()
        .any(|(sc, _)| sc.as_ref() == Some(shortcut))
}

/// Records what each binding is actually doing.
///
/// A hotkey can fail in two unrelated ways - the spec does not parse, or it
/// parses but Windows hands the key to whoever asked for it first - and both
/// used to be swallowed: the parse error by an `.ok()`, the registration error
/// by an event emitted during setup, before any window exists to receive it.
/// The result was an app that simply stopped responding to the keyboard with
/// nothing anywhere to say why. This is kept so the UI can ask at any time.
#[derive(Clone, Serialize, Default)]
struct HotkeyState {
    spec: String,
    bound: bool,
    error: String,
    /// The unusable spec this binding was reset away from at startup, if any.
    /// Empty in the normal case.
    reset_from: String,
}

/// One line's binding: who it belongs to, and what its key is doing.
#[derive(Clone, Serialize, Default)]
struct HotkeySlot {
    profile_id: String,
    name: String,
    state: HotkeyState,
}

fn register_hotkeys(app: &AppHandle) -> anyhow::Result<()> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    let state = app.state::<AppState>();

    // Repair before binding. A spec that cannot parse is not something the
    // user can fix from the keyboard - the app it would be fixed in is the one
    // that has stopped answering the keyboard - so an unusable saved value is
    // put back to the default rather than left to disable dictation forever.
    // Settings then reports what was reset and why.
    let (profiles, resets) = {
        let mut s = state.settings.lock().unwrap();
        let defaults = default_profiles();
        let mut resets = vec![String::new(); s.profiles.len()];
        for (i, p) in s.profiles.iter_mut().enumerate() {
            if parse_hotkey(&p.hotkey).is_err() {
                resets[i] = p.hotkey.clone();
                p.hotkey = defaults
                    .get(i)
                    .map(|d| d.hotkey.clone())
                    .unwrap_or_else(|| format!("CmdOrControl+F{}", 8 + i));
            }
        }
        if resets.iter().any(|r| !r.is_empty()) {
            let _ = save_settings(&s);
        }
        (s.profiles.clone(), resets)
    };

    // More specific combinations first: on Windows a bare F8 and Ctrl+F8
    // coexist fine, so ordering by modifier count keeps a prefix collision
    // from eating the plainer binding.
    let mut ordered: Vec<usize> = (0..profiles.len()).collect();
    ordered.sort_by_key(|&i| {
        profiles[i]
            .hotkey
            .matches('+')
            .count()
    });
    ordered.reverse();

    let mut slots: Vec<Option<HotkeySlot>> = vec![None; profiles.len()];
    let mut bindings: Vec<(Option<Shortcut>, String)> = vec![(None, String::new()); profiles.len()];
    for i in ordered {
        let p = &profiles[i];
        let (sc, mut report) = bind(&gs, &p.hotkey);
        report.reset_from = resets[i].clone();
        bindings[i] = (sc.clone(), p.id.clone());
        slots[i] = Some(HotkeySlot {
            profile_id: p.id.clone(),
            name: p.name.clone(),
            state: report,
        });
    }

    *state.shortcuts.lock().unwrap() = bindings;
    *state.hotkey_report.lock().unwrap() = slots.into_iter().flatten().collect();

    // unregister_all() above wiped an armed Escape along with everything
    // else, so put it back if a recording happens to be live right now.
    if state.status() == Status::Recording {
        arm_escape(app);
    }

    Ok(())
}

/// Parses and registers one spec, reporting whichever step failed.
fn bind(
    gs: &tauri_plugin_global_shortcut::GlobalShortcut<tauri::Wry>,
    spec: &str,
) -> (Option<Shortcut>, HotkeyState) {
    let mut report = HotkeyState {
        spec: spec.to_string(),
        bound: false,
        error: String::new(),
        reset_from: String::new(),
    };

    let shortcut = match parse_hotkey(spec) {
        Ok(sc) => sc,
        Err(e) => {
            report.error = e;
            eprintln!("[nutq] hotkey {spec:?} not usable: {}", report.error);
            return (None, report);
        }
    };

    match gs.register(shortcut) {
        Ok(()) => report.bound = true,
        Err(e) => {
            report.error = format!(
                "Windows refused this key - another app is probably already using it                  globally. Pick a different one. ({e})"
            );
            eprintln!("[nutq] hotkey {spec:?} not bound: {}", report.error);
            // The shortcut is still returned so it can be retried: the spec
            // is valid, and Windows hands the key to whoever asks first, so
            // the app holding it may yet let go.
        }
    }
    (Some(shortcut), report)
}

/// Windows hands a global hotkey to whoever asks for it first, and a binding
/// that was refused at startup stays refused: nothing ever asks again. That
/// left an app whose hotkey silently did nothing at all until the next restart
/// - the same symptom as a pill that never appears, and just as unexplained.
/// So an unbound hotkey is retried on a slow timer, because the app holding
/// the key may well release it.
fn spawn_hotkey_retry(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let task = app.clone();
        // Registering belongs to the thread that owns the message queue, and
        // must never run inside the plugin's own dispatch.
        let _ = app.run_on_main_thread(move || retry_unbound_hotkeys(&task));
    });
}

fn retry_unbound_hotkeys(app: &AppHandle) {
    let state = app.state::<AppState>();
    // A snapshot, so the report lock is never held across a registration.
    let report = state.hotkey_report.lock().unwrap().clone();

    for slot in &report {
        if slot.state.bound {
            continue;
        }
        let Ok(shortcut) = parse_hotkey(&slot.state.spec) else {
            continue;
        };
        if app.global_shortcut().register(shortcut).is_err() {
            continue;
        }

        {
            let mut shortcuts = state.shortcuts.lock().unwrap();
            if let Some(entry) = shortcuts.iter_mut().find(|(_, id)| *id == slot.profile_id) {
                entry.0 = Some(shortcut);
            }
        }
        {
            let mut report = state.hotkey_report.lock().unwrap();
            if let Some(entry) = report
                .iter_mut()
                .find(|e| e.profile_id == slot.profile_id)
            {
                entry.state.bound = true;
                entry.state.error = String::new();
            }
        }
        emit_warning(
            app,
            format!(
                "The shortcut {} is registered now. Another app was holding it when nutq started.",
                slot.state.spec
            ),
        );
    }
}

// ---------------------------------------------------------------- setup

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // Update checks point at GitHub Releases; the signing key that makes
        // them verifiable lives outside the repo (see AGENTS.md). The
        // frontend owns when to check and how the offer is presented.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<AppState>();

                    // Escape while the mic is live comes first, and it throws
                    // the recording away - that is the whole point of the key.
                    if *state.escape_armed.lock().unwrap() && shortcut == &escape_shortcut() {
                        cancel_recording(app);
                        return;
                    }

                    let profile_id = {
                        let s = state.settings.lock().unwrap();
                        let bindings = state.shortcuts.lock().unwrap().clone();
                        match bindings.iter().find(|(sc, _)| sc.as_ref() == Some(shortcut)) {
                            Some((_, id)) => s.profile(id).id,
                            None => return,
                        }
                    };
                    toggle_recording(app, &profile_id);
                })
                .build(),
        )
        .manage(AppState {
            recorder: Recorder::spawn(),
            settings: Mutex::new(load_settings()),
            history: Mutex::new(load_history()),
            status: Mutex::new(Status::Idle),
            pending_profile: Mutex::new(String::new()),
            pending_mic: Mutex::new(String::new()),
            shortcuts: Mutex::new(Vec::new()),
            hotkey_report: Mutex::new(Vec::new()),
            escape_armed: Mutex::new(false),
            // A fresh install is healthy until proven otherwise: the overlay
            // page has not had the chance to beat yet, and a supervisor that
            // judged it in that window would reload it on every cold start.
            overlay_watch: Mutex::new(OverlayWatch {
                frame: Some(Instant::now()),
                poll: Some(Instant::now()),
                healed_at: None,
                stage: 0,
            }),
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            set_api_key,
            key_status,
            list_microphones,
            check_hotkey,
            hotkey_status,
            get_history,
            get_latest,
            get_history_audio,
            clear_history,
            delete_history_entry,
            regenerate_history_entry,
            get_history_stats,
            get_usage,
            get_quota,
            copy_text,
            get_status,
            test_provider,
            list_models,
            toggle,
            get_pending,
            retry_pending,
            discard_pending,
            get_todos,
            toggle_todo,
            add_todo_item,
            remove_todo_item,
            delete_todo_list,
            get_notes,
            update_note,
            set_note_kind,
            delete_note,
            get_logs,
            clear_logs,
            overlay_alive,
            overlay_frame,
            overlay_state,
        ])
        .setup(|app| {
            // macOS: keep the standard Regular policy. Accessory hides the
            // Dock icon but its windows never become key on click, which left
            // the whole UI without keyboard input on real Macs. The overlay
            // never calls show() after startup (it only moves), so it cannot
            // steal focus during dictation either way.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            register_hotkeys(app.handle())?;
            build_tray(app.handle())?;
            build_overlay(app.handle())?;
            spawn_level_ticker(app.handle().clone());
            // Both supervisors are the reason a stuck pill or a hotkey that
            // another app took no longer needs the app restarted.
            spawn_overlay_watchdog(app.handle().clone());
            spawn_hotkey_retry(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                // The overlay is never hidden: hiding a WebView2 window
                // suspends its renderer, and the pill that does not come back
                // from that is the bug the supervisor exists to prevent. Its
                // window is rebuilt with `destroy`, which bypasses this
                // handler on purpose.
                if window.label() == "overlay" {
                    return;
                }
                // Closing the window hides it; the app keeps listening for the
                // hotkey from the tray. Quit is an explicit tray action.
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running nutq");
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", "Open nutq", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("nutq - press your hotkey to dictate")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_hotkey;

    /// The exact shape of the bug this replaced: the numpad plus written as
    /// "+" cannot parse, because `+` is the separator, and the name that does
    /// work is not one anybody would guess. Both halves are asserted so a
    /// parser change cannot quietly bring the trap back.
    #[test]
    fn numpad_plus_needs_its_code_name() {
        assert!(parse_hotkey("+").is_err());
        assert!(parse_hotkey("NumpadAdd").is_ok());
        assert!(parse_hotkey("Control+NumpadAdd").is_ok());
    }

    /// What the capture field emits has to round-trip, since it is built from
    /// `KeyboardEvent.code` rather than from anything Rust hands out.
    #[test]
    fn captured_specs_parse() {
        for spec in [
            "F8",
            "Control+F8",
            "CmdOrControl+F8",
            "Control+Shift+KeyD",
            "Alt+Digit1",
            "NumpadEnter",
            "Super+Space",
        ] {
            assert!(parse_hotkey(spec).is_ok(), "should parse: {spec}");
        }
    }

    #[test]
    fn escape_parses_for_the_rescue_binding() {
        assert!(parse_hotkey("Escape").is_ok());
    }

    #[test]
    fn empty_is_rejected() {
        assert!(parse_hotkey("").is_err());
        assert!(parse_hotkey("   ").is_err());
    }
}
