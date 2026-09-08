//! Stage 1: audio -> raw transcript.
//!
//! Three backends behind one function. Gemini takes the audio inline as base64
//! in a normal generateContent call; the other two are multipart file uploads.
//! Adding a provider means adding a match arm and a request builder - nothing
//! above this module needs to know which one is in use.

use anyhow::{anyhow, Result};
use base64::Engine;
use serde::Deserialize;
use std::time::Duration;

use crate::modes;
use crate::net::{self, Stage};
use crate::settings::{Settings, SttProvider};

const STAGE: Stage = Stage::Transcription;

const GEMINI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const ELEVENLABS_ENDPOINT: &str = "https://api.elevenlabs.io/v1/speech-to-text";

pub struct Transcript {
    pub text: String,
    /// Zero when the provider has no published per-token rate we can apply.
    pub cost_usd: f64,
}

/// `retries` is the 429 budget for this attempt - small when a backup provider
/// is waiting, full when this is the only chance. `timeout` bounds each
/// attempt; it is short when the primary has a backup behind it, so a dead
/// primary hands over quickly instead of hanging the status on "Transcribing".
pub async fn transcribe(
    api_key: &str,
    cfg: &Settings,
    prompt: &str,
    wav: &[u8],
    retries: u32,
    timeout: Duration,
) -> Result<Transcript> {
    match cfg.stt_provider {
        SttProvider::Gemini => {
            gemini(api_key, &cfg.stt_model, prompt, wav, retries, timeout).await
        }
        SttProvider::ElevenLabs => eleven_labs(api_key, &cfg.stt_model, wav, retries, timeout).await,
        SttProvider::OpenaiCompatible => {
            // Whisper's prompt is a continuation seed, not an instruction -
            // it gets the vocabulary-only hint, never the full prompt.
            let hint = modes::transcription_hint(cfg);
            openai_compatible(
                api_key,
                &cfg.stt_base_url,
                &cfg.stt_model,
                &hint,
                modes::language_code(cfg).as_deref(),
                wav,
                retries,
                timeout,
            )
            .await
        }
    }
}

// ---------------------------------------------------------------- gemini

#[derive(Deserialize)]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
    #[serde(rename = "usageMetadata", default)]
    usage: Option<GeminiUsage>,
    #[serde(rename = "promptFeedback", default)]
    prompt_feedback: Option<PromptFeedback>,
}

#[derive(Deserialize)]
struct Candidate {
    #[serde(default)]
    content: Option<Content>,
    #[serde(rename = "finishReason", default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Deserialize)]
struct Part {
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct GeminiUsage {
    #[serde(rename = "promptTokenCount", default)]
    prompt_tokens: u64,
    #[serde(rename = "candidatesTokenCount", default)]
    output_tokens: u64,
}

#[derive(Deserialize)]
struct PromptFeedback {
    #[serde(rename = "blockReason", default)]
    block_reason: Option<String>,
}

async fn gemini(
    api_key: &str,
    model: &str,
    prompt: &str,
    wav: &[u8],
    retries: u32,
    timeout: Duration,
) -> Result<Transcript> {
    let audio_b64 = base64::engine::general_purpose::STANDARD.encode(wav);

    let body = serde_json::json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                { "inline_data": { "mime_type": "audio/wav", "data": audio_b64 } }
            ]
        }],
        "generationConfig": {
            "temperature": 0,
            // Transcription needs no reasoning; this is a straight latency win.
            "thinkingConfig": { "thinkingBudget": 0 }
        }
    });

    let url = format!("{GEMINI_ENDPOINT}/{model}:generateContent");
    let text = post_json(&url, &[("x-goog-api-key", api_key)], &body, false, retries, timeout)
        .await?;

    let parsed: GeminiResponse = serde_json::from_str(&text)
        .map_err(|e| anyhow!("could not parse the Gemini response: {e}\n\nCalled: {url}"))?;

    if let Some(reason) = parsed.prompt_feedback.and_then(|f| f.block_reason) {
        return Err(anyhow!("Gemini blocked the audio ({reason})"));
    }

    let candidate = parsed
        .candidates
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("Gemini returned no transcript"))?;

    // MAX_TOKENS here means the transcript was cut off mid-sentence; better to
    // say so than to silently paste a truncated thought.
    if candidate.finish_reason.as_deref() == Some("MAX_TOKENS") {
        return Err(anyhow!(
            "the recording was too long and the transcript was cut off"
        ));
    }

    let transcript = candidate
        .content
        .map(|c| {
            c.parts
                .into_iter()
                .filter_map(|p| p.text)
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    let usage = parsed.usage.unwrap_or_default();

    Ok(Transcript {
        text: non_empty(transcript)?,
        cost_usd: gemini_cost(model, usage.prompt_tokens, usage.output_tokens),
    })
}

/// Rough running total for the usage counter, not a billing record. Check the
/// real number on the Google AI Studio billing page before relying on it.
fn gemini_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let (in_rate, out_rate) = if model.contains("pro") {
        (1.25, 10.0)
    } else if model.contains("flash-lite") {
        (0.10, 0.40)
    } else {
        (0.30, 2.50) // flash
    };
    (input_tokens as f64 / 1_000_000.0) * in_rate
        + (output_tokens as f64 / 1_000_000.0) * out_rate
}

// ---------------------------------------------------------------- multipart

#[derive(Deserialize)]
struct TextResponse {
    #[serde(default)]
    text: Option<String>,
}

async fn eleven_labs(
    api_key: &str,
    model: &str,
    wav: &[u8],
    retries: u32,
    timeout: Duration,
) -> Result<Transcript> {
    // The app stores "scribe_v1" style ids here; fall back rather than send an
    // empty model_id if the field was cleared.
    let model_id = if model.trim().is_empty() {
        "scribe_v1"
    } else {
        model.trim()
    };

    let client = net::client(timeout)?;
    let body = net::send_retrying(STAGE, ELEVENLABS_ENDPOINT, false, retries, || {
        let form = reqwest::multipart::Form::new()
            .text("model_id", model_id.to_string())
            .part("file", wav_part(wav)?);
        Ok(client
            .post(ELEVENLABS_ENDPOINT)
            .header("xi-api-key", api_key)
            .multipart(form))
    })
    .await?;

    let parsed: TextResponse = serde_json::from_str(&body)
        .map_err(|e| anyhow!("could not parse the ElevenLabs response: {e}"))?;

    Ok(Transcript {
        text: non_empty(parsed.text.unwrap_or_default())?,
        cost_usd: 0.0, // billed in characters against a plan, not per token
    })
}

async fn openai_compatible(
    api_key: &str,
    base_url: &str,
    model: &str,
    prompt: &str,
    language: Option<&str>,
    wav: &[u8],
    retries: u32,
    timeout: Duration,
) -> Result<Transcript> {
    let base = net::normalize_base_url(base_url, STAGE)?;
    let model = model.trim();
    if model.is_empty() {
        return Err(anyhow!(
            "{}: no model name is set. Add the one this endpoint expects in Settings.",
            STAGE.label()
        ));
    }

    let url = format!("{base}/audio/transcriptions");
    let client = net::client(timeout)?;
    let body = net::send_retrying(STAGE, &url, true, retries, || {
        let mut form = reqwest::multipart::Form::new()
            .text("model", model.to_string())
            // Whisper conditions on this text and may echo it on weak audio, so
            // it must be vocabulary only - see modes::transcription_hint.
            .text("prompt", prompt.to_string())
            .text("response_format", "json")
            // Whisper samples, and on near-silence it invents fluent text
            // ("English subtitles by ..."). Pinning the temperature to zero
            // makes it take the likeliest path instead of a creative one.
            .text("temperature", "0")
            .part("file", wav_part(wav)?);
        // Without this the model re-guesses the language for every clip, which
        // is how Levantine Arabic comes back as English sentences.
        if let Some(code) = language {
            form = form.text("language", code.to_string());
        }
        Ok(client.post(&url).bearer_auth(api_key).multipart(form))
    })
    .await?;

    let parsed: TextResponse = serde_json::from_str(&body).map_err(|e| {
        anyhow!(
            "{}: the reply was not the expected transcription shape ({e}). The URL may point at \
             something that is not an OpenAI-compatible API.\n\nCalled: {url}",
            STAGE.label()
        )
    })?;

    Ok(Transcript {
        text: non_empty(parsed.text.unwrap_or_default())?,
        cost_usd: 0.0, // rates vary per endpoint; not tracked
    })
}

fn wav_part(wav: &[u8]) -> Result<reqwest::multipart::Part> {
    reqwest::multipart::Part::bytes(wav.to_vec())
        .file_name("speech.wav")
        .mime_str("audio/wav")
        .map_err(|e| anyhow!("could not build the audio upload: {e}"))
}

// ---------------------------------------------------------------- shared

async fn post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: &serde_json::Value,
    url_is_users: bool,
    retries: u32,
    timeout: Duration,
) -> Result<String> {
    let client = net::client(timeout)?;
    net::send_retrying(STAGE, url, url_is_users, retries, || {
        let mut req = client.post(url).header("content-type", "application/json");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        Ok(req.json(body))
    })
    .await
}

fn non_empty(text: String) -> Result<String> {
    let trimmed = text.trim();
    // Whisper-family models hallucinate on silence and noise - "!!!", "...",
    // "Thank you." over pure room tone. A transcript with no letters or
    // digits in it carries no speech, so treat it as silence rather than
    // paste punctuation into the user's document.
    let has_speech = trimmed.chars().any(|c| c.is_alphanumeric());
    if trimmed.is_empty() || !has_speech {
        return Err(anyhow!(
            "no speech was detected in the recording. The request itself succeeded, so check \
             that the right microphone is selected in Settings."
        ));
    }
    Ok(trimmed.to_string())
}

/// 300 ms of silence, used by the Settings "Test" button.
///
/// A real WAV over the real code path: it exercises the URL, the key, the
/// model name, and the request shape. An empty transcript coming back is the
/// expected success case here, not a failure.
fn silent_wav() -> Vec<u8> {
    let samples = (crate::audio::TARGET_RATE as usize) * 3 / 10;
    let data_len = samples * 2;

    let mut w = Vec::with_capacity(44 + data_len);
    w.extend(b"RIFF");
    w.extend(((36 + data_len) as u32).to_le_bytes());
    w.extend(b"WAVEfmt ");
    w.extend(16u32.to_le_bytes()); // PCM header size
    w.extend(1u16.to_le_bytes()); // PCM
    w.extend(1u16.to_le_bytes()); // mono
    w.extend(crate::audio::TARGET_RATE.to_le_bytes());
    w.extend((crate::audio::TARGET_RATE * 2).to_le_bytes()); // byte rate
    w.extend(2u16.to_le_bytes()); // block align
    w.extend(16u16.to_le_bytes()); // bits per sample
    w.extend(b"data");
    w.extend((data_len as u32).to_le_bytes());
    w.resize(44 + data_len, 0);
    w
}

/// Minimal round trip for the Settings "Test" button.
pub async fn test(api_key: &str, cfg: &Settings) -> Result<String> {
    let wav = silent_wav();
    let prompt = "Transcribe this audio.";

    // An empty transcript is the expected answer to silence, so only a real
    // error should fail the test.
    // One attempt: a test that silently sat through a retry ladder would
    // report "slow" as "fine", which is the opposite of what it is for.
    let tries = net::FAILOVER_RETRIES;
    let outcome = match cfg.stt_provider {
        SttProvider::Gemini => {
            gemini(api_key, &cfg.stt_model, prompt, &wav, tries, net::TEST_TIMEOUT).await
        }
        SttProvider::ElevenLabs => {
            eleven_labs(api_key, &cfg.stt_model, &wav, tries, net::TEST_TIMEOUT).await
        }
        SttProvider::OpenaiCompatible => {
            openai_compatible(
                api_key,
                &cfg.stt_base_url,
                &cfg.stt_model,
                prompt,
                modes::language_code(cfg).as_deref(),
                &wav,
                tries,
                net::TEST_TIMEOUT,
            )
            .await
        }
    };

    match outcome {
        Ok(_) => Ok(format!("{} accepted the audio.", cfg.stt_model)),
        // "no speech detected" means the round trip worked - that is a pass.
        Err(e) if e.to_string().starts_with("no speech was detected") => Ok(format!(
            "{} accepted the audio and returned an empty transcript, which is correct for \
             silence.",
            cfg.stt_model
        )),
        Err(e) => Err(e),
    }
}
