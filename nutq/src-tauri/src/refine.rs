//! Stage 2: raw transcript -> finished text.
//!
//! Three backends behind one function. The mode prompt is the same for all of
//! them; only the request shape and where the system prompt goes differs.

use anyhow::{anyhow, Result};
use serde::Deserialize;

use crate::modes;
use crate::net::{self, Stage};
use crate::settings::{RefineProvider, Settings};

const STAGE: Stage = Stage::Refinement;

const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const GEMINI_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Routes around a safety refusal server-side instead of handing the user a
/// dead end. Dictation cleanup should essentially never trip a classifier, but
/// "essentially never" is not never.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

const MAX_OUTPUT_TOKENS: u32 = 8000;

pub struct Refined {
    pub text: String,
    /// Zero when the provider has no published rate we can apply.
    pub cost_usd: f64,
}

/// `retries` is the 429 budget for this attempt - small when a backup provider
/// is waiting, full when this is the only chance.
pub async fn refine(
    api_key: &str,
    cfg: &Settings,
    system: &str,
    transcript: &str,
    retries: u32,
) -> Result<Refined> {
    match cfg.refine_provider {
        RefineProvider::Anthropic => {
            anthropic(
                api_key,
                &cfg.refine_anthropic_base_url,
                &cfg.refine_model,
                system,
                modes::effort(cfg.mode),
                transcript,
                retries,
            )
            .await
        }
        RefineProvider::Gemini => {
            gemini(api_key, &cfg.refine_model, system, transcript, retries).await
        }
        RefineProvider::OpenaiCompatible => {
            openai_compatible(
                api_key,
                &cfg.refine_base_url,
                &cfg.refine_model,
                system,
                transcript,
                retries,
            )
            .await
        }
    }
}

// ---------------------------------------------------------------- anthropic

#[derive(Deserialize)]
struct MessageResponse {
    #[serde(default)]
    content: Vec<Block>,
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    stop_details: Option<StopDetails>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Deserialize)]
struct StopDetails {
    #[serde(default)]
    explanation: Option<String>,
}

#[derive(Deserialize, Default)]
struct AnthropicUsage {
    #[serde(default)]
    input_tokens: u64,
    #[serde(default)]
    output_tokens: u64,
}

/// Adaptive thinking stays on and the dial we turn per mode is `effort`.
/// Disabling thinking on Opus 5 is the tempting way to cut latency but it has
/// two documented failure modes - leaked `<thinking>` tags in the visible
/// answer, and tool calls written into prose. Low effort with thinking on is
/// both cheaper and safer.
///
/// A non-empty `base_url` switches to an Anthropic-compatible service (GLM's
/// coding endpoint, a proxy). Those speak the plain Messages shape, and the
/// Claude-only extras - adaptive thinking, effort, the fallback beta - are
/// exactly what a compat layer is likeliest to reject, so they are dropped
/// there rather than risk a 400 on a working key.
async fn anthropic(
    api_key: &str,
    base_url: &str,
    model: &str,
    system: &str,
    effort: &str,
    transcript: &str,
    retries: u32,
) -> Result<Refined> {
    let custom = !base_url.trim().is_empty();
    let url = if custom {
        format!("{}/v1/messages", net::normalize_base_url(base_url, STAGE)?)
    } else {
        ANTHROPIC_ENDPOINT.to_string()
    };

    let body = if custom {
        serde_json::json!({
            "model": model,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "system": system,
            "messages": [{ "role": "user", "content": transcript }],
            "temperature": 0.3,
            // Reasoning models such as GLM will think first and can burn the
            // entire output budget doing so, returning no text block at all.
            // Dictation polish needs no reasoning, so switch it off.
            "thinking": { "type": "disabled" }
        })
    } else {
        serde_json::json!({
            "model": model,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "system": system,
            "messages": [{ "role": "user", "content": transcript }],
            "thinking": { "type": "adaptive" },
            "output_config": { "effort": effort },
            "fallbacks": "default"
        })
    };

    let mut headers = vec![
        ("x-api-key", api_key),
        ("anthropic-version", ANTHROPIC_VERSION),
    ];
    if !custom {
        headers.push(("anthropic-beta", FALLBACK_BETA));
    }

    let text = post_json(&url, &headers, &body, custom, retries).await?;

    let parsed: MessageResponse = serde_json::from_str(&text)
        .map_err(|e| anyhow!("could not parse the Claude response: {e}"))?;

    // A refusal is an HTTP 200 with no usable content - check before reading it.
    if parsed.stop_reason.as_deref() == Some("refusal") {
        let why = parsed
            .stop_details
            .and_then(|d| d.explanation)
            .unwrap_or_else(|| "the refinement request was declined".into());
        return Err(anyhow!("{why}"));
    }

    let out: String = parsed
        .content
        .iter()
        .filter(|b| b.kind == "text")
        .filter_map(|b| b.text.as_deref())
        .collect::<Vec<_>>()
        .join("");

    let usage = parsed.usage.unwrap_or_default();

    // Per-token rates are only known for real Claude models, not for whatever
    // a compatible endpoint is actually serving.
    let cost_usd = if custom {
        0.0
    } else {
        anthropic_cost(model, usage.input_tokens, usage.output_tokens)
    };

    Ok(Refined {
        text: non_empty(out, &url)?,
        cost_usd,
    })
}

/// Published per-million-token rates, so this total is exact rather than an
/// estimate.
fn anthropic_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let (in_rate, out_rate) = match model {
        "claude-opus-5" | "claude-opus-4-8" | "claude-opus-4-7" | "claude-opus-4-6" => (5.0, 25.0),
        "claude-sonnet-5" => (2.0, 10.0),
        "claude-sonnet-4-6" => (3.0, 15.0),
        "claude-haiku-4-5" => (1.0, 5.0),
        "claude-fable-5-1" | "claude-fable-5" => (10.0, 50.0),
        _ => (5.0, 25.0),
    };
    (input_tokens as f64 / 1_000_000.0) * in_rate
        + (output_tokens as f64 / 1_000_000.0) * out_rate
}

// ---------------------------------------------------------------- gemini

#[derive(Deserialize)]
struct GeminiResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
    #[serde(rename = "usageMetadata", default)]
    usage: Option<GeminiUsage>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    #[serde(default)]
    content: Option<GeminiContent>,
}

#[derive(Deserialize)]
struct GeminiContent {
    #[serde(default)]
    parts: Vec<GeminiPart>,
}

#[derive(Deserialize)]
struct GeminiPart {
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

async fn gemini(
    api_key: &str,
    model: &str,
    system: &str,
    transcript: &str,
    retries: u32,
) -> Result<Refined> {
    let body = serde_json::json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": [{ "text": transcript }] }],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": MAX_OUTPUT_TOKENS
        }
    });

    let url = format!("{GEMINI_ENDPOINT}/{model}:generateContent");
    let text = post_json(&url, &[("x-goog-api-key", api_key)], &body, false, retries).await?;

    let parsed: GeminiResponse = serde_json::from_str(&text)
        .map_err(|e| anyhow!("could not parse the Gemini response: {e}"))?;

    let out = parsed
        .candidates
        .into_iter()
        .next()
        .and_then(|c| c.content)
        .map(|c| {
            c.parts
                .into_iter()
                .filter_map(|p| p.text)
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    let usage = parsed.usage.unwrap_or_default();

    Ok(Refined {
        text: non_empty(out, &url)?,
        cost_usd: gemini_cost(model, usage.prompt_tokens, usage.output_tokens),
    })
}

fn gemini_cost(model: &str, input_tokens: u64, output_tokens: u64) -> f64 {
    let (in_rate, out_rate) = if model.contains("pro") {
        (1.25, 10.0)
    } else if model.contains("flash-lite") {
        (0.10, 0.40)
    } else {
        (0.30, 2.50)
    };
    (input_tokens as f64 / 1_000_000.0) * in_rate
        + (output_tokens as f64 / 1_000_000.0) * out_rate
}

// ---------------------------------------------------------------- generic

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    message: Option<ChatMessage>,
}

#[derive(Deserialize)]
struct ChatMessage {
    #[serde(default)]
    content: Option<String>,
}

/// The `POST {base}/chat/completions` shape, which GLM, DeepSeek, OpenRouter,
/// Groq, and most local servers all speak.
async fn openai_compatible(
    api_key: &str,
    base_url: &str,
    model: &str,
    system: &str,
    transcript: &str,
    retries: u32,
) -> Result<Refined> {
    let base = net::normalize_base_url(base_url, STAGE)?;
    let model = model.trim();
    if model.is_empty() {
        return Err(anyhow!(
            "{}: no model name is set. Add the one this endpoint expects in Settings.",
            STAGE.label()
        ));
    }

    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": transcript }
        ],
        "temperature": 0.3,
        "max_tokens": MAX_OUTPUT_TOKENS
    });

    let url = format!("{base}/chat/completions");
    let bearer = format!("Bearer {api_key}");
    let text = post_json(&url, &[("authorization", &bearer)], &body, true, retries).await?;

    let parsed: ChatResponse = serde_json::from_str(&text).map_err(|e| {
        anyhow!(
            "{}: the reply was not the expected chat-completions shape ({e}). The URL may point \
             at something that is not an OpenAI-compatible API.\n\nCalled: {url}",
            STAGE.label()
        )
    })?;

    let out = parsed
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .unwrap_or_default();

    Ok(Refined {
        text: non_empty(out, &url)?,
        cost_usd: 0.0, // rates vary per endpoint; not tracked
    })
}

/// Minimal round trip for the Settings "Test" button: same URL, same key, same
/// model, trivial payload. Anything that would break the real call breaks this
/// one too, with the same diagnostics.
pub async fn test(api_key: &str, cfg: &Settings) -> Result<String> {
    let probe = "Reply with the single word: ok";
    // One attempt, same reasoning as the transcription test.
    let tries = net::FAILOVER_RETRIES;

    match cfg.refine_provider {
        RefineProvider::Anthropic => {
            anthropic(
                api_key,
                &cfg.refine_anthropic_base_url,
                &cfg.refine_model,
                "Reply concisely.",
                "low",
                probe,
                tries,
            )
            .await?;
            Ok(format!("Claude answered as {}.", cfg.refine_model))
        }
        RefineProvider::Gemini => {
            gemini(api_key, &cfg.refine_model, "Reply concisely.", probe, tries).await?;
            Ok(format!("Gemini answered as {}.", cfg.refine_model))
        }
        RefineProvider::OpenaiCompatible => {
            let base = net::normalize_base_url(&cfg.refine_base_url, STAGE)?;
            openai_compatible(
                api_key,
                &cfg.refine_base_url,
                &cfg.refine_model,
                "Reply concisely.",
                probe,
                tries,
            )
            .await?;
            Ok(format!(
                "{}/chat/completions answered as {}.",
                base, cfg.refine_model
            ))
        }
    }
}

// ---------------------------------------------------------------- shared

/// Posts JSON and returns the body, converting both transport failures and
/// error statuses into messages that name the stage and the URL. Throttling
/// (HTTP 429) is retried with backoff inside net::send_retrying.
async fn post_json(
    url: &str,
    headers: &[(&str, &str)],
    body: &serde_json::Value,
    url_is_users: bool,
    retries: u32,
) -> Result<String> {
    let client = net::api_client()?;
    net::send_retrying(STAGE, url, url_is_users, retries, || {
        let mut req = client.post(url).header("content-type", "application/json");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        Ok(req.json(body))
    })
    .await
}

fn non_empty(text: String, url: &str) -> Result<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(
            "{}: the request succeeded but the reply had no text in it. The model may have \
             returned only a refusal or an empty completion.\n\nCalled: {url}",
            STAGE.label()
        ));
    }
    Ok(trimmed.to_string())
}
