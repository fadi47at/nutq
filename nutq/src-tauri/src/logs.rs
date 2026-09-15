//! Persistent log of warnings and errors.
//!
//! Warnings and errors reach the UI as toasts, and a toast is gone the moment
//! it is dismissed - or worse, it was never read while dictation carried on.
//! This file is the record: everything the app warns or errors about is
//! appended here with its timestamp, so "why did transcription keep failing
//! this morning" has an answer after the fact. The Logs page reads it.

use serde::{Deserialize, Serialize};
use std::fs;

use crate::settings::config_dir;

/// Newest 200 are kept. Warnings arrive at human pace, so this is days of
/// history, not minutes - and it bounds the file without any rotation logic.
const MAX_LOGS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub id: String,
    pub at: String,
    /// "warning" or "error".
    pub level: String,
    pub message: String,
}

fn path() -> Option<std::path::PathBuf> {
    config_dir().ok().map(|d| d.join("logs.json"))
}

pub fn list() -> Vec<LogEntry> {
    path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Appends one entry, newest first. Writing is best-effort on purpose: the
/// log is a convenience, and a full disk must not turn a warning into a
/// failure of its own.
pub fn add(level: &str, message: &str) {
    let mut entries = list();
    entries.insert(
        0,
        LogEntry {
            id: format!("{}", chrono::Local::now().timestamp_millis()),
            at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            level: level.to_string(),
            message: message.to_string(),
        },
    );
    entries.truncate(MAX_LOGS);
    if let Some(p) = path() {
        let _ = fs::write(p, serde_json::to_string_pretty(&entries).unwrap_or_default());
    }
}

pub fn clear() {
    if let Some(p) = path() {
        let _ = fs::write(p, "[]");
    }
}

/// How much of the overlay's trail is kept: enough for days of ordinary use,
/// without any rotation logic.
const MAX_DIAG_LINES: usize = 400;

/// The recording indicator's own trail, in its own file.
///
/// The pill fails intermittently and invisibly: by the time anyone asks why,
/// the app has been restarted and there is nothing left to look at. The
/// installed build captures no stderr at all, so every placement, show,
/// repair and recovery is written here instead - newest last, oldest dropped.
/// Diagnostics rather than news, which is why it is not `logs.json`: that one
/// is for things the user is meant to read.
pub fn diag(message: &str) {
    eprintln!("[nutq] {message}");
    let mut lines: Vec<String> = path()
        .map(|p| p.with_file_name("overlay.log"))
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default();
    lines.push(format!(
        "{} {message}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    ));
    if lines.len() > MAX_DIAG_LINES {
        lines.drain(0..lines.len() - MAX_DIAG_LINES);
    }
    if let Some(p) = path().map(|p| p.with_file_name("overlay.log")) {
        let _ = fs::write(p, lines.join("\n") + "\n");
    }
}
