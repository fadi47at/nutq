//! Failed calls parked for a later retry.
//!
//! When a stage fails on every configured provider, the work is not thrown
//! away: the audio (or the transcript, once stage 1 succeeded) is kept on
//! disk so the user can re-run it later - with the same providers after the
//! outage passes, or with different ones after switching in Settings.
//! Retry always uses the CURRENT settings, so "fix it in Settings, then hit
//! retry" is the whole workflow.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::settings::{config_dir, Mode, Output};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEntry {
    pub id: String,
    pub created_at: String,
    /// Which stage the failure happened at: "transcription" or "refinement".
    pub stage: String,
    /// The last error text, so the retry list says why it is there.
    pub error: String,
    pub seconds: f32,
    pub mode: Mode,
    pub output: Output,
    /// The microphone this audio came from, carried through so a retry lands
    /// in history with the same provenance as a first-try result.
    #[serde(default)]
    pub microphone: String,
    /// Set when the failure was at stage 1: the wav file name inside the
    /// pending directory.
    pub wav_file: Option<String>,
    /// Set when stage 1 succeeded and only refinement failed.
    pub transcript: Option<String>,
}

fn pending_dir() -> Result<PathBuf> {
    let dir = config_dir()?.join("pending");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn index_path() -> Result<PathBuf> {
    Ok(pending_dir()?.join("pending.json"))
}

pub fn list() -> Vec<PendingEntry> {
    index_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_all(entries: &[PendingEntry]) -> Result<()> {
    fs::write(
        index_path()?,
        serde_json::to_string_pretty(entries).unwrap_or_default(),
    )?;
    Ok(())
}

/// Parks a failed job. `wav` is written to its own file; everything else goes
/// into the index. Keeps at most 20 jobs and deletes the wavs of dropped ones
/// so the folder cannot grow without bound.
pub fn add(mut entry: PendingEntry, wav: Option<&[u8]>) -> Result<()> {
    let dir = pending_dir()?;
    if let Some(bytes) = wav {
        let name = format!("{}.wav", entry.id);
        fs::write(dir.join(&name), bytes)?;
        entry.wav_file = Some(name);
    }

    let mut entries = list();
    entries.insert(0, entry);
    while entries.len() > 20 {
        let dropped = entries.pop();
        if let Some(d) = dropped {
            if let Some(name) = d.wav_file {
                let _ = fs::remove_file(dir.join(name));
            }
        }
    }
    save_all(&entries)
}

pub fn get(id: &str) -> Option<PendingEntry> {
    list().into_iter().find(|e| e.id == id)
}

/// Reads the parked audio without removing it - the job only leaves the list
/// when a retry actually succeeds.
pub fn read_wav(id: &str) -> Result<Vec<u8>> {
    let entry = get(id).ok_or_else(|| anyhow!("pending job not found"))?;
    let name = entry
        .wav_file
        .ok_or_else(|| anyhow!("this job has no audio to retry"))?;
    fs::read(pending_dir()?.join(name)).map_err(|e| anyhow!("could not read the parked audio: {e}"))
}

/// Replaces a transcription-stage job with a refinement-stage one: stage 1
/// now succeeded, so the wav goes away and the transcript is what matters.
pub fn promote_to_refinement(id: &str, transcript: &str, error: &str) -> Result<()> {
    let dir = pending_dir()?;
    let mut entries = list();
    let Some(entry) = entries.iter_mut().find(|e| e.id == id) else {
        return Ok(());
    };
    if let Some(name) = &entry.wav_file {
        let _ = fs::remove_file(dir.join(name));
    }
    entry.wav_file = None;
    entry.transcript = Some(transcript.to_string());
    entry.stage = "refinement".to_string();
    entry.error = error.to_string();
    save_all(&entries)
}

pub fn update_error(id: &str, error: &str) -> Result<()> {
    let mut entries = list();
    if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
        entry.error = error.to_string();
    }
    save_all(&entries)
}

pub fn remove(id: &str) -> Result<()> {
    let dir = pending_dir()?;
    let mut entries = list();
    if let Some(entry) = entries.iter().find(|e| e.id == id).cloned() {
        if let Some(name) = entry.wav_file {
            let _ = fs::remove_file(dir.join(name));
        }
    }
    entries.retain(|e| e.id != id);
    save_all(&entries)
}
