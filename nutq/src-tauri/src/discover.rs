//! Asking each provider which models it actually offers.
//!
//! A hardcoded model list is wrong the moment a provider retires a name. That
//! already happened once here: Gemini 2.5 was pulled for new accounts and the
//! app kept sending it, producing a 404 that read like a broken URL. So the
//! authoritative list comes from the provider, keyed by the user's own
//! credentials - which also means it shows what *their* account can reach,
//! not what some account somewhere can.

use anyhow::{anyhow, Result};
use serde::Deserialize;

use crate::net::{self, Stage};
use crate::settings::{RefineProvider, Settings, SttProvider};

const GEMINI_MODELS: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_MODELS: &str = "https://api.anthropic.com/v1/models";

pub async fn for_stt(api_key: &str, cfg: &Settings) -> Result<Vec<String>> {
    match cfg.stt_provider {
        SttProvider::Gemini => gemini(api_key, Stage::Transcription).await,
        SttProvider::ElevenLabs => Err(anyhow!(
            "ElevenLabs does not publish a model list here. Use scribe_v1."
        )),
        SttProvider::OpenaiCompatible => {
            openai_compatible(api_key, &cfg.stt_base_url, Stage::Transcription).await
        }
    }
}

pub async fn for_refine(api_key: &str, cfg: &Settings) -> Result<Vec<String>> {
    match cfg.refine_provider {
        RefineProvider::Anthropic => {
            anthropic(api_key, &cfg.refine_anthropic_base_url).await
        }
        RefineProvider::Gemini => gemini(api_key, Stage::Refinement).await,
        RefineProvider::OpenaiCompatible => {
            openai_compatible(api_key, &cfg.refine_base_url, Stage::Refinement).await
        }
    }
}

// ---------------------------------------------------------------- gemini

#[derive(Deserialize)]
struct GeminiList {
    #[serde(default)]
    models: Vec<GeminiModel>,
    #[serde(rename = "nextPageToken", default)]
    next_page_token: Option<String>,
}

#[derive(Deserialize)]
struct GeminiModel {
    #[serde(default)]
    name: String,
    #[serde(rename = "supportedGenerationMethods", default)]
    methods: Vec<String>,
}

async fn gemini(api_key: &str, stage: Stage) -> Result<Vec<String>> {
    let client = net::api_client()?;
    let mut out = Vec::new();
    let mut page: Option<String> = None;

    // A handful of pages is plenty; the cap stops a malformed cursor from
    // looping forever.
    for _ in 0..5 {
        let url = match &page {
            Some(token) => format!("{GEMINI_MODELS}?pageSize=200&pageToken={token}"),
            None => format!("{GEMINI_MODELS}?pageSize=200"),
        };

        let body = get(&client, &url, &[("x-goog-api-key", api_key)], stage).await?;
        let parsed: GeminiList = serde_json::from_str(&body)
            .map_err(|e| anyhow!("could not read the Gemini model list: {e}"))?;

        for m in parsed.models {
            // Only models that can answer a generateContent call are usable
            // here; embedding models would just fail later.
            if m.methods.iter().any(|x| x == "generateContent") {
                out.push(m.name.trim_start_matches("models/").to_string());
            }
        }

        match parsed.next_page_token {
            Some(t) if !t.is_empty() => page = Some(t),
            _ => break,
        }
    }

    finish(out, "Gemini")
}

// ---------------------------------------------------------------- anthropic

#[derive(Deserialize)]
struct AnthropicList {
    #[serde(default)]
    data: Vec<IdOnly>,
}

#[derive(Deserialize)]
struct IdOnly {
    #[serde(default)]
    id: String,
}

async fn anthropic(api_key: &str, base_url: &str) -> Result<Vec<String>> {
    let client = net::api_client()?;
    // Same /v1/models listing Claude Code uses, against whichever compatible
    // base the user configured; empty means the real Anthropic API.
    let (url, who) = if base_url.trim().is_empty() {
        (format!("{ANTHROPIC_MODELS}?limit=100"), "Claude".to_string())
    } else {
        let base = net::normalize_base_url(base_url, Stage::Refinement)?;
        (format!("{base}/v1/models"), base)
    };
    let body = get(
        &client,
        &url,
        &[("x-api-key", api_key), ("anthropic-version", "2023-06-01")],
        Stage::Refinement,
    )
    .await?;

    let parsed: AnthropicList = serde_json::from_str(&body)
        .map_err(|e| anyhow!("could not read the Claude model list: {e}"))?;

    finish(parsed.data.into_iter().map(|m| m.id).collect(), &who)
}

// ---------------------------------------------------------------- generic

async fn openai_compatible(api_key: &str, base_url: &str, stage: Stage) -> Result<Vec<String>> {
    let base = net::normalize_base_url(base_url, stage)?;
    let url = format!("{base}/models");
    let bearer = format!("Bearer {api_key}");

    let client = net::api_client()?;
    let body = get(&client, &url, &[("authorization", &bearer)], stage).await?;

    let parsed: AnthropicList = serde_json::from_str(&body).map_err(|e| {
        anyhow!(
            "{url} did not return an OpenAI-style model list ({e}). Some endpoints do not \
             expose one - type the model name in by hand instead."
        )
    })?;

    finish(parsed.data.into_iter().map(|m| m.id).collect(), &base)
}

// ---------------------------------------------------------------- shared

async fn get(
    client: &reqwest::Client,
    url: &str,
    headers: &[(&str, &str)],
    stage: Stage,
) -> Result<String> {
    let mut req = client.get(url);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| anyhow!("{}", net::transport_error(stage, url, &e)))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| anyhow!("{}", net::transport_error(stage, url, &e)))?;

    if !status.is_success() {
        return Err(anyhow!(
            "{}",
            net::http_error(stage, url, status.as_u16(), &text)
        ));
    }
    Ok(text)
}

/// Sorted and de-duplicated, newest-looking names first so the useful ones are
/// not buried under a long tail of dated snapshots.
fn finish(mut models: Vec<String>, who: &str) -> Result<Vec<String>> {
    models.retain(|m| !m.trim().is_empty());
    models.sort();
    models.dedup();

    if models.is_empty() {
        return Err(anyhow!(
            "{who} returned an empty model list for this key."
        ));
    }
    Ok(models)
}
