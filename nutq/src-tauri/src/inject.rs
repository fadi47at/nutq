//! Getting the finished text into whatever field has focus.
//!
//! Synthesising the text keystroke by keystroke is the obvious approach and
//! the wrong one: it is slow for long passages, it drops characters in apps
//! that debounce input, and it mangles Arabic entirely because the keystrokes
//! carry no script information. So we go through the clipboard and send one
//! Ctrl+V, then put the user clipboard back the way we found it.

use anyhow::{anyhow, Result};
use std::thread::sleep;
use std::time::Duration;

/// The clipboard is shared global state that the user is also using. Set it,
/// paste, and restore what was there - a dictation tool that eats whatever you
/// had copied is a tool people stop trusting.
pub fn paste(text: &str) -> Result<()> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| anyhow!("could not open the clipboard: {e}"))?;

    // May legitimately fail: the clipboard can be empty or hold an image.
    let previous = clipboard.get_text().ok();

    clipboard
        .set_text(text.to_string())
        .map_err(|e| anyhow!("could not write to the clipboard: {e}"))?;

    // Give the target app a moment to see the new clipboard contents before
    // the paste keystroke arrives.
    sleep(Duration::from_millis(60));

    send_paste()?;

    // Restore only after the paste has certainly been read. Too short a delay
    // here and the app pastes the restored value instead of the new one.
    sleep(Duration::from_millis(250));
    if let Some(prev) = previous {
        let _ = clipboard.set_text(prev);
    }

    Ok(())
}

/// Leaves the text on the clipboard without pasting - for the draft window,
/// where the user decides where it goes.
pub fn copy_only(text: &str) -> Result<()> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text.to_string()))
        .map_err(|e| anyhow!("could not write to the clipboard: {e}"))
}

#[cfg(windows)]
fn send_paste() -> Result<()> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_CONTROL, VK_V,
    };

    fn key(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    let down = KEYBD_EVENT_FLAGS(0);
    let inputs = [
        key(VK_CONTROL, down),
        key(VK_V, down),
        key(VK_V, KEYEVENTF_KEYUP),
        key(VK_CONTROL, KEYEVENTF_KEYUP),
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };

    if sent as usize != inputs.len() {
        // Blocked input usually means a UAC-elevated window has focus and our
        // process is not elevated. The text is on the clipboard either way.
        return Err(anyhow!(
            "could not send the paste keystroke - the text is on your clipboard, press Ctrl+V"
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn send_paste() -> Result<()> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use std::thread::sleep;

    // kVK_ANSI_V = 9; the command flag marks it as Cmd+V for the frontmost app.
    const V_KEY: u16 = 9;
    const CMD_FLAG: CGEventFlags = CGEventFlags::CGEventFlagCommand;

    // Posting synthesized key events requires the user to have granted this
    // app Accessibility (System Settings > Privacy & Security > Accessibility).
    // Without it the events post "successfully" but no app receives them, so
    // the clipboard fallback message below is what the user acts on.
    let post = |key_down: bool| -> Result<()> {
        let ev = CGEvent::new_keyboard_event(None, V_KEY, key_down)
            .ok_or_else(|| anyhow!("could not create the paste event"))?;
        ev.set_flags(CMD_FLAG);
        ev.post(CGEventTapLocation::Session);
        Ok(())
    };

    post(true)?;
    sleep(Duration::from_millis(20));
    post(false)?;
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn send_paste() -> Result<()> {
    Err(anyhow!("automatic pasting is only implemented on Windows and macOS"))
}
