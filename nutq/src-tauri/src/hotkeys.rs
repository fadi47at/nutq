//! The line bindings: parsing specs, registering them with Windows, the
//! mid-recording Escape rescue key, and the slow retry that recovers a key
//! another app was holding at startup. Moved as-is from lib.rs.

use crate::{emit_warning, AppState, Status};
use crate::settings::{default_profiles, save_settings};
use serde::Serialize;
use std::str::FromStr;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

// ---------------------------------------------------------------- hotkeys

/// Turns a spec into a shortcut, with a message aimed at the person who typed
/// it rather than at the parser.
///
/// The plural spelling matters here: the parser splits on `+` before it looks
/// at anything, so a lone "+" is two empty tokens and can never mean the
/// numpad key. That key is "NumpadAdd", and there is no way to discover that
/// by typing - which is exactly why the Settings field records a keypress
/// instead of asking for a name.
pub(crate) fn parse_hotkey(spec: &str) -> Result<Shortcut, String> {
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
pub(crate) fn escape_shortcut() -> Shortcut {
    Shortcut::from_str("Escape").expect("Escape is a valid key name")
}

/// While the mic is live, Escape cancels the session outright: no
/// transcription, no history row, no paste, no cost. Without the binding the
/// keystroke would slip through to whatever app is being dictated into,
/// where it tends to close a dialog and take the dictation's destination
/// with it. It is registered for the length of the recording only. If the
/// user's own hotkey IS Escape, the normal handler already stops the
/// recording and there is nothing to arm.
pub(crate) fn arm_escape(app: &AppHandle) {
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
pub(crate) fn disarm_escape(app: &AppHandle) {
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
pub(crate) struct HotkeySlot {
    profile_id: String,
    name: String,
    state: HotkeyState,
}

pub(crate) fn register_hotkeys(app: &AppHandle) -> anyhow::Result<()> {
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
pub(crate) fn spawn_hotkey_retry(app: AppHandle) {
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
