//! Getting the finished text into whatever field has focus.
//!
//! Synthesising the text keystroke by keystroke is the obvious approach and
//! the wrong one: it is slow for long passages, it drops characters in apps
//! that debounce input, and it mangles Arabic entirely because the keystrokes
//! carry no script information. So we go through the clipboard and send one
//! Ctrl+V, then put the user clipboard back the way we found it.

use crate::i18n::{tr, trf};
use anyhow::{anyhow, Result};
use std::thread::sleep;
use std::time::Duration;

/// The clipboard is shared global state that the user is also using. Set it,
/// paste, and restore what was there - a dictation tool that eats whatever you
/// had copied is a tool people stop trusting.
pub fn paste(text: &str) -> Result<()> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| anyhow!(trf("could not open the clipboard: {e}", &[("e", &e)])))?;

    // May legitimately fail: the clipboard can be empty or hold an image.
    let previous = clipboard.get_text().ok();

    clipboard
        .set_text(text.to_string())
        .map_err(|e| anyhow!(trf("could not write to the clipboard: {e}", &[("e", &e)])))?;

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
        .map_err(|e| anyhow!(trf("could not write to the clipboard: {e}", &[("e", &e)])))
}

/// Puts one file on the clipboard as a copied file, the way Explorer does,
/// so it can be pasted into anything that accepts a dropped file - a chat
/// that takes voice notes, an upload box, a folder. Text and images go
/// through arboard; a file needs CF_HDROP, which arboard does not carry.
pub fn copy_file(path: &std::path::Path) -> Result<()> {
    copy_file_impl(path)
}

#[cfg(windows)]
fn copy_file_impl(path: &std::path::Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::DROPFILES;

    // CF_HDROP: one DROPFILES header followed by a list of
    // double-null-terminated wide paths. We place exactly one path.
    const CF_HDROP: u32 = 15;
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain([0, 0])
        .collect();
    let header = std::mem::size_of::<DROPFILES>();
    let total = header + wide.len() * std::mem::size_of::<u16>();

    unsafe {
        // On any failure after the allocation the block is deliberately not
        // freed: windows 0.58 exposes no GlobalFree, and these paths are rare
        // errors costing at most a few hundred bytes until the app exits.
        let hglobal = GlobalAlloc(GMEM_MOVEABLE, total)
            .map_err(|e| anyhow!(trf("could not allocate clipboard memory: {e}", &[("e", &e)])))?;
        let base = GlobalLock(hglobal);
        if base.is_null() {
            return Err(anyhow!(tr("could not lock clipboard memory")));
        }
        let base = base as *mut u8;
        std::ptr::write(
            base as *mut DROPFILES,
            DROPFILES {
                pFiles: header as u32,
                pt: Default::default(),
                fNC: false.into(),
                fWide: true.into(),
            },
        );
        std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, base.add(header), wide.len() * 2);
        let _ = GlobalUnlock(hglobal);

        // The clipboard owns the memory once SetClipboardData succeeds; on
        // any failure it would still be ours, but see the note above.
        let placed = OpenClipboard(HWND(std::ptr::null_mut()))
            .map_err(|e| anyhow!(trf("could not open the clipboard: {e}", &[("e", &e)])))
            .and_then(|_| {
                let _ = EmptyClipboard();
                SetClipboardData(CF_HDROP, HANDLE(hglobal.0))
                    .map(|_| ())
                    .map_err(|e| anyhow!(trf("could not place the file on the clipboard: {e}", &[("e", &e)])))
            });
        let _ = CloseClipboard();
        placed
    }
}

#[cfg(not(windows))]
fn copy_file_impl(_path: &std::path::Path) -> Result<()> {
    Err(anyhow!(tr(
        "copying a recording as a file is implemented for Windows so far"
    )))
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
        return Err(anyhow!(tr(
            "could not send the paste keystroke - the text is on your clipboard, press Ctrl+V"
        )));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn send_paste() -> Result<()> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    use std::thread::sleep;

    // kVK_ANSI_V = 9; the command flag marks it as Cmd+V for the frontmost app.
    const V_KEY: u16 = 9;
    const CMD_FLAG: CGEventFlags = CGEventFlags::CGEventFlagCommand;

    // Posting synthesized key events requires the user to have granted this
    // app Accessibility (System Settings > Privacy & Security > Accessibility).
    // Without it the events post "successfully" but no app receives them, so
    // the clipboard fallback message below is what the user acts on.
    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| anyhow!(tr("could not create the event source")))?;
    let post = |source: &CGEventSource, key_down: bool| -> Result<()> {
        let ev = match CGEvent::new_keyboard_event(source.clone(), V_KEY, key_down) {
            Ok(ev) => ev,
            Err(_) => return Err(anyhow!(tr("could not create the paste event"))),
        };
        ev.set_flags(CMD_FLAG);
        ev.post(CGEventTapLocation::Session);
        Ok(())
    };

    post(&source, true)?;
    sleep(Duration::from_millis(20));
    post(&source, false)?;
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn send_paste() -> Result<()> {
    Err(anyhow!(tr("automatic pasting is only implemented on Windows and macOS")))
}
