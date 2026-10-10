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

/// Copies a clip to `%TEMP%\nutq` under a name a person can read - the date
/// and the first words of what was said - and returns that path, ready to go
/// on the clipboard. The pasted file says what it is instead of an internal
/// id, which is what a chat full of voice notes needs.
///
/// The copy is an **mp3**: clips are stored as wav, and wav is exactly what
/// most chats refuse to take. If encoding ever fails, the wav is copied
/// anyway - a file the user can still convert beats an error. The original
/// clip is untouched; exports live for a day and are swept on the next copy.
pub fn export_for_clipboard(name: &str, at: &str, text: &str) -> Result<PathBuf> {
    let wav = read(name)?;
    let dir = std::env::temp_dir().join("nutq");
    fs::create_dir_all(&dir)?;

    // One day is far longer than any paste takes; old exports only pile up.
    if let Ok(files) = fs::read_dir(&dir) {
        let day = std::time::SystemTime::now()
            .checked_sub(std::time::Duration::from_secs(24 * 60 * 60));
        for f in files.flatten() {
            if let (Ok(modified), Some(cutoff)) = (f.metadata().and_then(|m| m.modified()), day) {
                if modified < cutoff {
                    let _ = fs::remove_file(f.path());
                }
            }
        }
    }

    let stem = friendly_stem(at, text);
    match encode_mp3(&wav) {
        Ok(mp3) => {
            let dest = dir.join(format!("{stem}.mp3"));
            fs::write(&dest, mp3)?;
            Ok(dest)
        }
        Err(_) => {
            let dest = dir.join(format!("{stem}.wav"));
            fs::write(&dest, &wav)?;
            Ok(dest)
        }
    }
}

/// One kept clip, re-encoded from its stored wav into an mp3 a chat will
/// accept. 64 kbps CBR is transparent for 16 kHz speech and keeps a
/// five-minute dictation around two megabytes.
fn encode_mp3(wav: &[u8]) -> Result<Vec<u8>> {
    use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, MonoPcm};

    let mut reader = hound::WavReader::new(std::io::Cursor::new(wav))?;
    let spec = reader.spec();
    if spec.channels != 1 || spec.bits_per_sample != 16 {
        return Err(anyhow!("unexpected clip format"));
    }
    let samples: Vec<i16> = reader
        .samples::<i16>()
        .collect::<std::result::Result<_, _>>()?;

    let mut encoder = Builder::new()
        .ok_or_else(|| anyhow!("could not create the mp3 encoder"))?
        .with_num_channels(1)?
        .with_sample_rate(spec.sample_rate)?
        .with_brate(Bitrate::Kbps64)?
        .build()?;

    // LAME writes the whole stream into one buffer and refuses to encode
    // into anything smaller, so the capacity must follow the crate's own
    // worst-case formula - a Vec that grows on demand never gets the chance.
    let mut out = Vec::with_capacity(mp3lame_encoder::max_required_buffer_size(samples.len()));
    encoder.encode_to_vec(MonoPcm(&samples), &mut out)?;

    // The flush finishes the last frame; it needs at least 7200 bytes.
    let mut tail = [std::mem::MaybeUninit::new(0u8); 7200];
    let written = encoder.flush::<FlushNoGap>(&mut tail)?;
    unsafe {
        out.extend_from_slice(std::slice::from_raw_parts(
            tail.as_ptr() as *const u8,
            written,
        ));
    }
    Ok(out)
}

/// "2026-09-24 17:30:00" + "مبارح رحنا على..." -> a stem Windows accepts,
/// trimmed so a chat window can show it whole.
fn friendly_stem(at: &str, text: &str) -> String {
    let stamp = at.replace(':', ".");
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut stem = if words.is_empty() {
        format!("nutq {stamp}")
    } else {
        format!("nutq {stamp} - {}", words.join(" "))
    };
    stem = stem
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '.',
            _ => c,
        })
        .collect();
    if stem.chars().count() > 60 {
        stem = stem.chars().take(60).collect();
    }
    stem.trim_end_matches('.').to_string()
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A one-second 16 kHz sine, encoded exactly the way a clipboard copy
    /// encodes a kept clip. If the mp3 path silently breaks, the wav
    /// fallback makes every paste fail in WhatsApp with no error anywhere -
    /// this test is what keeps that failure visible.
    #[test]
    fn clip_encodes_to_a_playable_mp3() {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for i in 0..16_000 {
                let t = i as f32 / 16_000.0;
                let s = (t * 440.0 * std::f32::consts::TAU).sin() * 0.3;
                w.write_sample((s * 32767.0) as i16).unwrap();
            }
            w.finalize().unwrap();
        }
        let mp3 = encode_mp3(&cursor.into_inner()).expect("mp3 encoding must work");
        assert!(!mp3.is_empty(), "encoder produced nothing");
        // The stream may open with an ID3v2 tag (0x49 'I' 0x44 'D' 0x33 '3')
        // or directly with a frame sync - both are playable mp3 files.
        assert!(
            mp3.starts_with(b"ID3") || mp3.starts_with(&[0xff]),
            "not an mp3 stream"
        );
        // A second of 64 kbps audio is roughly 8 kB.
        assert!(mp3.len() > 4_000, "suspiciously small: {} bytes", mp3.len());
    }

    /// Long input is where the buffer sizing actually bites: a short clip
    /// sneaks through on the flush headroom, a five-minute one does not.
    /// Sixty seconds is comfortably past that edge.
    #[test]
    fn long_clip_encodes_too() {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut cursor = std::io::Cursor::new(Vec::new());
        {
            let mut w = hound::WavWriter::new(&mut cursor, spec).unwrap();
            for i in 0..16_000 * 60 {
                let t = i as f32 / 16_000.0;
                let s = (t * 220.0 * std::f32::consts::TAU).sin() * 0.2;
                w.write_sample((s * 32767.0) as i16).unwrap();
            }
            w.finalize().unwrap();
        }
        let mp3 = encode_mp3(&cursor.into_inner()).expect("long clip must encode");
        // 60 s at 64 kbps is roughly 480 kB.
        assert!(mp3.len() > 400_000, "too small for a minute: {}", mp3.len());
    }

    /// The full export path against the machine's real clips folder: if a
    /// clip exists, export it exactly the way the clipboard button does and
    /// verify the temp file actually lands on disk.
    #[test]
    fn real_clip_exports_end_to_end() {
        let clips = dir().expect("clips dir");
        let Some(clip) = fs::read_dir(&clips)
            .ok()
            .and_then(|files| {
                files
                    .flatten()
                    .find(|f| f.path().extension().is_some_and(|e| e == "wav"))
            })
        else {
            return; // no clips on this machine - nothing to verify
        };
        let name = clip.file_name().to_string_lossy().to_string();
        let out = export_for_clipboard(&name, "2026-10-10 21:01", "اختبار التصدير")
            .expect("export works");
        assert!(out.exists(), "exported file is missing: {}", out.display());
        let bytes = fs::read(&out).expect("exported file is readable");
        assert!(bytes.len() > 1_000, "exported file too small");
        eprintln!("exported: {} ({} bytes)", out.display(), bytes.len());
    }
}
