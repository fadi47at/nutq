//! Microphone capture.
//!
//! `cpal::Stream` is `!Send` on Windows, so the stream is owned by one
//! dedicated thread for the whole life of the app and driven over a channel.
//! Samples are collected in memory and downmixed to 16 kHz mono, which is what
//! every STT provider wants and keeps the upload about 6x smaller than the
//! device native 48 kHz stereo. Whether the finished wav is then kept on disk
//! is not decided here - see `clips`.

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Cursor;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};

/// What we hand to the STT provider.
pub const TARGET_RATE: u32 = 16_000;

/// Recordings longer than this are rejected. Gemini takes audio inline up to
/// ~20 MB per request; 10 min of 16 kHz mono WAV base64-encoded lands around
/// 25 MB, so we stop well short of it. Lifting this means moving to the
/// Files API instead of inline_data.
pub const MAX_SECONDS: usize = 300;

/// Shortest clip worth sending to a transcriber.
///
/// A tap on the hotkey - pressing it twice in quick succession, or bumping it -
/// produces about 0.15 s of audio. That is far too little to be speech, but
/// Whisper does not answer "nothing"; it invents fluent text from its training
/// data ("Bacchus", "English subtitles by ..."), which then costs an API call,
/// lands in history, and can be pasted into whatever has focus. Real dictation
/// is comfortably above this, so the floor costs nothing and removes the whole
/// class of phantom results.
pub const MIN_SPEECH_SECONDS: f32 = 0.4;

/// What a finished capture turned out to be.
///
/// The two rejections are separated because they mean different things to the
/// user: one is an accidental keypress, the other is a microphone that heard
/// nothing at all - which is worth saying out loud, since it usually means the
/// wrong input device is selected or it is muted.
pub enum Capture {
    /// A clip worth transcribing: a complete 16 kHz mono WAV.
    Ready(Vec<u8>),
    /// Not one sample rose above the silence floor.
    Silent,
    /// Speech was found, but less of it than `MIN_SPEECH_SECONDS`.
    TooShort(f32),
}

enum Cmd {
    Start(Option<String>, Sender<Result<()>>),
    Stop(Sender<Result<Capture>>),
}

pub struct Recorder {
    tx: Sender<Cmd>,
    /// Latest chunk loudness as `f32::to_bits` RMS in [0, 1], written by the
    /// capture callback and read by the overlay's level ticker. Atomic so the
    /// real-time callback never takes a lock.
    level: Arc<AtomicU32>,
    /// The device the last successful `start` actually opened. Settings may
    /// say "Default", which resolves to a different mic depending on what is
    /// plugged in, so history records what was really used, not what was asked
    /// for.
    device: Arc<Mutex<String>>,
}

impl Recorder {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel();
        let level = Arc::new(AtomicU32::new(0));
        let device = Arc::new(Mutex::new(String::new()));
        let thread_level = level.clone();
        let thread_device = device.clone();
        std::thread::spawn(move || audio_thread(rx, thread_level, thread_device));
        Self { tx, level, device }
    }

    pub fn start(&self, device_name: Option<String>) -> Result<()> {
        let (rtx, rrx) = mpsc::channel();
        self.tx.send(Cmd::Start(device_name, rtx))?;
        rrx.recv()?
    }

    /// Stops the stream and reports what was captured - a WAV worth sending,
    /// or why it is not worth sending.
    pub fn stop(&self) -> Result<Capture> {
        let (rtx, rrx) = mpsc::channel();
        self.tx.send(Cmd::Stop(rtx))?;
        rrx.recv()?
    }

    /// Shared handle to the live loudness value, for whoever wants to draw it.
    pub fn level_handle(&self) -> Arc<AtomicU32> {
        self.level.clone()
    }

    /// Name of the device the current (or most recent) capture opened.
    pub fn current_device(&self) -> String {
        self.device.lock().map(|d| d.clone()).unwrap_or_default()
    }
}

fn audio_thread(rx: Receiver<Cmd>, level: Arc<AtomicU32>, device_name_out: Arc<Mutex<String>>) {
    // Stream and buffer stay parked on this thread between commands.
    let mut stream: Option<cpal::Stream> = None;
    let mut buffer: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));
    let mut source_rate: u32 = TARGET_RATE;
    let mut channels: u16 = 1;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            Cmd::Start(device_name, reply) => {
                let result = (|| -> Result<()> {
                    let mut last_err = None;
                    for attempt in 0..3 {
                        match open_stream(device_name.as_deref(), &level) {
                            Ok((s, rate, ch, buf, opened)) => {
                                source_rate = rate;
                                channels = ch;
                                buffer = buf;
                                stream = Some(s);
                                if let Ok(mut d) = device_name_out.lock() {
                                    *d = opened;
                                }
                                return Ok(());
                            }
                            Err(e) => {
                                // WASAPI calls the mic "in use" for a moment
                                // while another app releases it or a
                                // Bluetooth headset swaps profile; that
                                // moment passes on its own, so wait it out
                                // before giving up.
                                let transient = format!("{e}").contains("0x8889000A");
                                last_err = Some(e);
                                if !transient || attempt == 2 {
                                    break;
                                }
                                std::thread::sleep(std::time::Duration::from_millis(450));
                            }
                        }
                    }
                    Err(last_err.unwrap())
                })();
                let _ = reply.send(result);
            }

            Cmd::Stop(reply) => {
                // Dropping the stream stops capture.
                stream = None;
                level.store(0f32.to_bits(), Ordering::Relaxed);
                let samples = buffer.lock().map(|b| b.clone()).unwrap_or_default();
                let result = if samples.is_empty() {
                    Err(anyhow!("nothing was recorded"))
                } else {
                    let mono = to_mono(&samples, channels);
                    let resampled = resample(&mono, source_rate, TARGET_RATE);
                    // `trim_silence` returning None is the pure-silence case.
                    // It cannot be detected from the trimmed length, because
                    // with nothing above the floor there is nothing to trim
                    // against and the whole buffer would come back untouched.
                    match trim_silence(&resampled) {
                        None => Ok(Capture::Silent),
                        Some(trimmed) => {
                            let secs = trimmed.len() as f32 / TARGET_RATE as f32;
                            if secs < MIN_SPEECH_SECONDS {
                                Ok(Capture::TooShort(secs))
                            } else {
                                encode_wav(&trimmed).map(Capture::Ready)
                            }
                        }
                    }
                };
                buffer = Arc::new(Mutex::new(Vec::new()));
                let _ = reply.send(result);
            }
        }
    }
}

/// Opens and starts one capture stream. Split out of the command loop so the
/// transient-failure retry above can call it again cleanly.
fn open_stream(
    device_name: Option<&str>,
    level: &Arc<AtomicU32>,
) -> Result<(cpal::Stream, u32, u16, Arc<Mutex<Vec<f32>>>, String)> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) if name != "Default" => host
            .input_devices()?
            .find(|d| d.name().map(|n| &n == name).unwrap_or(false))
            .ok_or_else(|| anyhow!("microphone not found: {name}"))?,
        _ => host
            .default_input_device()
            .ok_or_else(|| anyhow!("no default microphone"))?,
    };

    let opened_name = device.name().unwrap_or_else(|_| "unknown microphone".to_string());
    let supported = device.default_input_config()?;
    let source_rate = supported.sample_rate().0;
    let channels = supported.channels();

    let buf = Arc::new(Mutex::new(Vec::<f32>::new()));
    let ret_buf = buf.clone();
    let cap = source_rate as usize * channels as usize * MAX_SECONDS;

    let err_fn = |e| eprintln!("audio stream error: {e}");
    let config: cpal::StreamConfig = supported.config();
    let level = level.clone();

    // Every sample format is normalised to f32 in [-1.0, 1.0].
    let s = match supported.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config,
            move |data: &[f32], _: &_| push(&buf, &level, data.iter().copied(), cap),
            err_fn,
            None,
        )?,
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config,
            move |data: &[i16], _: &_| {
                push(&buf, &level, data.iter().map(|s| *s as f32 / 32768.0), cap)
            },
            err_fn,
            None,
        )?,
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config,
            move |data: &[u16], _: &_| {
                push(
                    &buf,
                    &level,
                    data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0),
                    cap,
                )
            },
            err_fn,
            None,
        )?,
        other => return Err(anyhow!("unsupported sample format: {other:?}")),
    };

    s.play()?;
    Ok((s, source_rate, channels, ret_buf, opened_name))
}

/// Turns a raw cpal/WASAPI failure into something the banner can act on.
/// The hex codes are stable WASAPI results and say far more than the string
/// cpal prints for them.
pub fn friendly_error(e: &anyhow::Error) -> String {
    let raw = format!("{e}");
    let hint = if raw.contains("0x8889000A") {
        Some(
            "The microphone is being held by another app right now - or a Bluetooth headset \
             just switched modes. Close the other app using the mic, or wait a couple of \
             seconds and press the hotkey again.",
        )
    } else if raw.contains("0x88890004") {
        Some(
            "The microphone disappeared mid-use - unplugged, disabled, or switched away. \
             Check that it is still selected in Settings.",
        )
    } else if raw.contains("0x88890008") {
        Some(
            "The microphone refuses this audio format. Try picking a different one in Settings.",
        )
    } else if raw.contains("0x8889000C") {
        Some(
            "The Windows audio service is not running. Start it (services.msc, \"Windows \
             Audio\") and try again.",
        )
    } else {
        None
    };
    match hint {
        Some(h) => format!("Microphone error: {raw}\n\n{h}"),
        None => raw,
    }
}

fn push(
    buf: &Arc<Mutex<Vec<f32>>>,
    level: &AtomicU32,
    samples: impl Iterator<Item = f32>,
    cap: usize,
) {
    let mut sum_sq = 0.0;
    let mut n = 0usize;
    if let Ok(mut b) = buf.lock() {
        for s in samples {
            sum_sq += s * s;
            n += 1;
            if b.len() < cap {
                b.push(s);
            }
        }
    }
    if n > 0 {
        let rms = (sum_sq / n as f32).sqrt();
        level.store(rms.to_bits(), Ordering::Relaxed);
    }
}

fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let n = channels as usize;
    samples
        .chunks(n)
        .map(|frame| frame.iter().sum::<f32>() / n as f32)
        .collect()
}

/// Box-filter lowpass followed by linear interpolation.
///
/// Decimating without a lowpass first aliases high frequencies down into the
/// speech band and measurably hurts transcription accuracy. A box filter is
/// crude but adequate for speech; swap in `rubato` if we ever chase the last
/// few points of accuracy.
fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;

    let filtered = if ratio > 1.0 {
        let width = (ratio.round() as usize).max(1);
        input
            .windows(width)
            .map(|w| w.iter().sum::<f32>() / w.len() as f32)
            .collect::<Vec<f32>>()
    } else {
        input.to_vec()
    };

    if filtered.is_empty() {
        return Vec::new();
    }

    let out_len = (filtered.len() as f64 / ratio).floor() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let pos = i as f64 * ratio;
        let idx = pos.floor() as usize;
        let frac = (pos - idx as f64) as f32;
        let a = filtered[idx.min(filtered.len() - 1)];
        let b = filtered[(idx + 1).min(filtered.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// Drops leading and trailing near-silence so we do not pay to transcribe the
/// gap between pressing the hotkey and actually starting to speak.
/// Drops leading and trailing near-silence, or reports that there was no
/// speech at all.
///
/// Returning None for "nothing above the floor" matters: the old version
/// returned the untouched buffer in that case, so a recording of pure silence
/// arrived at the transcriber at full length and looked exactly like a normal
/// clip - which is how minutes of nothing became invented sentences.
fn trim_silence(samples: &[f32]) -> Option<Vec<f32>> {
    const THRESHOLD: f32 = 0.01;
    const PAD: usize = TARGET_RATE as usize / 10; // keep 100 ms either side

    let first = samples.iter().position(|s| s.abs() > THRESHOLD)?;
    let last = samples.iter().rposition(|s| s.abs() > THRESHOLD)?;

    let start = first.saturating_sub(PAD);
    let end = (last + PAD).min(samples.len());
    Some(samples[start..end].to_vec())
}

fn encode_wav(samples: &[f32]) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)?;
        for s in samples {
            writer.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(cursor.into_inner())
}

pub fn list_input_devices() -> Vec<String> {
    let mut names = vec!["Default".to_string()];
    if let Ok(devices) = cpal::default_host().input_devices() {
        names.extend(devices.filter_map(|d| d.name().ok()));
    }
    names
}

pub fn duration_seconds(wav_len: usize) -> f32 {
    // 16-bit mono at TARGET_RATE, minus the 44-byte header.
    wav_len.saturating_sub(44) as f32 / (TARGET_RATE as f32 * 2.0)
}

#[cfg(test)]
mod tests {
    use super::{trim_silence, MIN_SPEECH_SECONDS, TARGET_RATE};

    fn secs(n: f32) -> usize {
        (TARGET_RATE as f32 * n) as usize
    }

    /// A tone loud enough to count as speech, surrounded by silence.
    fn clip(silence_before: f32, tone: f32, silence_after: f32) -> Vec<f32> {
        let mut v = vec![0.0f32; secs(silence_before)];
        v.extend(std::iter::repeat(0.5).take(secs(tone)));
        v.extend(std::iter::repeat(0.0).take(secs(silence_after)));
        v
    }

    /// The case a duration check alone cannot catch: minutes of pure silence
    /// used to come back untrimmed, at full length, indistinguishable from a
    /// real clip - and Whisper answered it with invented sentences.
    #[test]
    fn pure_silence_is_rejected_however_long() {
        assert!(trim_silence(&vec![0.0; secs(3.0)]).is_none());
        assert!(trim_silence(&vec![0.0; secs(60.0)]).is_none());
        // Below the floor but not exactly zero - still not speech.
        assert!(trim_silence(&vec![0.002; secs(5.0)]).is_none());
    }

    /// An accidental tap: real audio, but far under the floor.
    #[test]
    fn a_tap_lands_under_the_minimum() {
        let trimmed = trim_silence(&clip(0.0, 0.02, 0.0)).expect("has a tone");
        let len = trimmed.len() as f32 / TARGET_RATE as f32;
        assert!(
            len < MIN_SPEECH_SECONDS,
            "a 0.02s tap should not reach the floor, got {len}s"
        );
    }

    /// Ordinary dictation must survive untouched, padding included.
    #[test]
    fn real_speech_passes_the_floor() {
        let trimmed = trim_silence(&clip(1.0, 3.0, 1.0)).expect("has speech");
        let len = trimmed.len() as f32 / TARGET_RATE as f32;
        assert!(len >= MIN_SPEECH_SECONDS, "3s of speech was rejected: {len}s");
        // 3s of tone plus 100ms padding either side, and the leading silence
        // must be gone rather than carried along.
        assert!((len - 3.2).abs() < 0.05, "expected ~3.2s, got {len}s");
    }
}
