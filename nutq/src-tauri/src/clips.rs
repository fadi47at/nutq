//! Recorded audio kept next to history so a result can be played back.
//!
//! Dictation used to be write-only: the wav lived in memory, went to the STT
//! provider, and was gone. But "what did I actually say there?" is a real
//! question when a transcript reads oddly, and only the audio answers it - so
//! each clip is now written beside its history entry.
//!
//! Audio is far bigger than text, so the two are capped separately: history
//! keeps 500 results, clips keep the newest `MAX_CLIPS`. Older entries stay in
//! the list, they just lose their play button. The whole thing is opt-out in
//! Settings for anyone who would rather nothing be written to disk.

use anyhow::{anyhow, Result};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use crate::settings::{config_dir, History};

/// 16 kHz mono 16-bit is ~32 kB/s, so 100 clips of typical dictation length
/// sit comfortably under a couple hundred megabytes even at the 5-minute cap.
pub const MAX_CLIPS: usize = 100;

fn dir() -> Result<PathBuf> {
    let dir = config_dir()?.join("clips");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Writes one clip and returns the file name to store on the history entry.
pub fn save(id: &str, wav: &[u8]) -> Result<String> {
    let name = format!("{id}.wav");
    fs::write(dir()?.join(&name), wav)?;
    Ok(name)
}

pub fn read(name: &str) -> Result<Vec<u8>> {
    // The name comes from a history entry, but it reaches us over the command
    // bridge, so refuse anything that is not a bare file name.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(anyhow!("bad clip name"));
    }
    fs::read(dir()?.join(name)).map_err(|e| anyhow!("the audio for this entry is gone: {e}"))
}

/// Keeps the newest `MAX_CLIPS` clips and drops the rest, both the files and
/// the references to them - an entry pointing at a deleted file would offer a
/// play button that fails. Entries are newest-first, so this is just a count.
/// Any file no history entry claims is removed too, which cleans up after a
/// crash between writing a clip and saving the index.
pub fn enforce_cap(history: &mut History) {
    let mut kept = 0usize;
    for entry in history.entries.iter_mut() {
        if entry.audio_file.is_none() {
            continue;
        }
        kept += 1;
        if kept > MAX_CLIPS {
            entry.audio_file = None;
        }
    }

    let referenced: HashSet<String> = history
        .entries
        .iter()
        .filter_map(|e| e.audio_file.clone())
        .collect();

    let Ok(dir) = dir() else { return };
    let Ok(files) = fs::read_dir(&dir) else { return };
    for f in files.flatten() {
        let name = f.file_name().to_string_lossy().to_string();
        if !referenced.contains(&name) {
            let _ = fs::remove_file(f.path());
        }
    }
}

/// Deletes one clip file, for a single deleted history entry. A missing file
/// is not an error - the goal is simply that it is gone.
pub fn remove(name: &str) {
    // Same rule as `read`: the name reaches us over the command bridge.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return;
    }
    if let Ok(dir) = dir() {
        let _ = fs::remove_file(dir.join(name));
    }
}

/// Clearing history clears the audio with it - the entries are what make the
/// clips findable, so leaving them behind would only waste disk.
pub fn clear() {
    if let Ok(dir) = dir() {
        if let Ok(files) = fs::read_dir(&dir) {
            for f in files.flatten() {
                let _ = fs::remove_file(f.path());
            }
        }
    }
}
