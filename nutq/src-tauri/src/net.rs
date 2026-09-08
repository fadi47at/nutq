//! Shared HTTP plumbing and, more importantly, error messages that say where
//! the failure was.
//!
//! When a custom endpoint fails there are four different things that could be
//! wrong - the URL, the network, the key, or the model name - and a raw
//! reqwest error or a bare "401" tells the user none of them apart. Every
//! message built here names the stage, the exact URL that was called, and what
//! to go change.

use anyhow::{anyhow, Result};
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// Long enough for a slow refinement on a big transcript, short enough that a
/// black-holed connection does not wedge the pipeline forever. Without this,
/// reqwest waits indefinitely and the app sits in "Refining" with no way out.
/// Also the timeout of a stage's last-chance attempt (a backup provider, or
/// the only provider when no backup is configured).
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

/// The timeout for the primary provider's attempt when a backup is configured.
///
/// A dictation clip is small, so a healthy endpoint answers well inside this.
/// A primary that has not answered by then is almost certainly dead, and
/// making the user wait out the full request timeout before the backup - the
/// provider that will actually answer - is even asked reads as the app hanging
/// on "Transcribing". The backup keeps the full timeout, so a genuinely slow
/// network still gets the time it needs on the attempt that matters.
pub const FAILOVER_TIMEOUT: Duration = Duration::from_secs(25);

/// The Settings test button should fail fast - the user is watching it. The
/// bound is applied around the whole call rather than on the client, so it
/// covers DNS, connect, and read alike without threading a timeout through
/// every provider function.
pub const TEST_TIMEOUT: Duration = Duration::from_secs(25);

/// Which half of the pipeline a message is about.
#[derive(Clone, Copy)]
pub enum Stage {
    Transcription,
    Refinement,
}

impl Stage {
    pub fn label(self) -> &'static str {
        match self {
            Stage::Transcription => "Stage 1 (transcription)",
            Stage::Refinement => "Stage 2 (refinement)",
        }
    }

    /// The Settings field to send the user to, by name.
    pub fn key_field(self) -> &'static str {
        match self {
            Stage::Transcription => "\"Transcription endpoint\" key",
            // Stage 2's key field is named after whichever provider is
            // selected, so name both instead of pointing at the wrong one.
            Stage::Refinement => "\"Claude\" (or \"Refinement endpoint\") key",
        }
    }
}

// ------------------------------------------------------------ rate budgets

/// One budget a provider reports back, such as "audio-seconds" or "requests".
///
/// Values are kept as the strings the provider sent. They are units we do not
/// own - Groq bills Whisper by seconds of audio, others by request count or
/// tokens - and reformatting them would only invent precision we do not have.
#[derive(Clone, Debug, Serialize)]
pub struct QuotaItem {
    /// The budget's name as the provider spells it, e.g. "audio-seconds".
    pub kind: String,
    pub limit: String,
    pub remaining: String,
    /// How long until this budget refills, as reported ("7.66s", "2m59.56s").
    pub reset: String,
}

/// What one provider last said about how much of the allowance is left.
#[derive(Clone, Debug, Serialize)]
pub struct Quota {
    /// The host that reported it. This is the identity of the reading: two
    /// providers serve the same stage, so without it a number is unattributable.
    pub host: String,
    /// Local time of the reply that carried these numbers.
    pub at: String,
    /// How many requests this app has sent to this host since it started, so a
    /// provider's own count can be sanity-checked against what we actually did.
    pub sent_this_session: u32,
    /// Requests sent to this host today, across restarts. This is the running
    /// total a provider's own `remaining` cannot give: a refilling allowance
    /// returns to full within minutes, so only a count we keep ourselves can
    /// answer "how much have I used today".
    pub sent_today: u32,
    pub items: Vec<QuotaItem>,
}

fn quota_store() -> &'static Mutex<BTreeMap<String, Quota>> {
    static STORE: OnceLock<Mutex<BTreeMap<String, Quota>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// Reads whatever `x-ratelimit-*` headers came back and remembers them per host.
///
/// Keyed by host rather than by stage, which was a real bug: the primary and
/// backup providers both serve the transcription stage, so a stage-keyed slot
/// meant whichever answered last overwrote the other - and a Gemini reading
/// could be displayed as though it were Groq's. Keeping one entry per host
/// makes every number self-attributing.
///
/// The header names are not hardcoded to any provider. Every suffix seen after
/// `x-ratelimit-limit-`, `-remaining-` or `-reset-` becomes a row, so a service
/// reporting `audio-seconds` and one reporting `tokens` are both shown as they
/// describe themselves, and nothing is silently dropped for not matching a
/// shape we expected.
fn record_quota(url: &str, headers: &reqwest::header::HeaderMap) {
    const PREFIXES: [&str; 3] = [
        "x-ratelimit-limit-",
        "x-ratelimit-remaining-",
        "x-ratelimit-reset-",
    ];

    let mut kinds: std::collections::BTreeSet<String> = Default::default();
    for name in headers.keys() {
        let n = name.as_str();
        for p in PREFIXES {
            if let Some(kind) = n.strip_prefix(p) {
                kinds.insert(kind.to_string());
            }
        }
    }

    let get = |name: String| -> String {
        headers
            .get(&name)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.trim().to_string())
            .unwrap_or_default()
    };

    let items: Vec<QuotaItem> = kinds
        .into_iter()
        .map(|kind| QuotaItem {
            limit: get(format!("x-ratelimit-limit-{kind}")),
            remaining: get(format!("x-ratelimit-remaining-{kind}")),
            reset: get(format!("x-ratelimit-reset-{kind}")),
            kind,
        })
        .collect();

    let host = url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or(url)
        .to_string();

    crate::settings::bump_daily_request(&host);
    let sent_today = crate::settings::load_daily_usage()
        .hosts
        .get(&host)
        .copied()
        .unwrap_or(0);

    if let Ok(mut store) = quota_store().lock() {
        // The send count is ours and must survive a reply that carried no
        // headers at all, so it is incremented before the early return below.
        let sent = store.get(&host).map(|q| q.sent_this_session).unwrap_or(0) + 1;
        if items.is_empty() && !store.contains_key(&host) {
            store.insert(
                host.clone(),
                Quota {
                    host,
                    at: chrono::Local::now().format("%H:%M:%S").to_string(),
                    sent_this_session: sent,
                    sent_today,
                    items,
                },
            );
            return;
        }
        let entry = store.entry(host.clone()).or_insert_with(|| Quota {
            host,
            at: String::new(),
            sent_this_session: 0,
            sent_today: 0,
            items: Vec::new(),
        });
        entry.sent_this_session = sent;
        entry.sent_today = sent_today;
        if !items.is_empty() {
            entry.at = chrono::Local::now().format("%H:%M:%S").to_string();
            entry.items = items;
        }
    }
}

/// Every host this session has talked to, with its last reported budget.
pub fn quotas() -> Vec<Quota> {
    quota_store()
        .lock()
        .map(|s| s.values().cloned().collect())
        .unwrap_or_default()
}

pub fn client(timeout: Duration) -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| anyhow!("could not start the HTTP client: {e}"))
}

pub fn api_client() -> Result<reqwest::Client> {
    client(REQUEST_TIMEOUT)
}

/// How many times a throttled request is re-sent before the error reaches the
/// user. Rate limits are usually gone within seconds, so a couple of quiet
/// retries turn most 429s into successes nobody sees.
pub const MAX_RATE_LIMIT_RETRIES: u32 = 4;

/// Retry budget for a stage that has a backup provider waiting.
///
/// The full ladder above sleeps 1+2+4+8 seconds before giving up. That is the
/// right trade when the only alternative is failing - but when a second
/// provider is configured, it is fifteen seconds of silence spent on a
/// provider that already said no, on every single dictation, before the one
/// that will actually answer is even asked. With somewhere to fail over to,
/// the backup is faster than the wait.
pub const FAILOVER_RETRIES: u32 = 0;

/// The longest wait honored from a Retry-After header. Providers sometimes ask
/// for minutes; a dictation app is better off surfacing the error than sitting
/// silent that long.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(20);

/// Sends a request, re-sending it automatically when the provider throttles it
/// with HTTP 429. `build` runs once per attempt because a request body cannot
/// be replayed - every retry needs a fresh request.
pub async fn send_retrying(
    stage: Stage,
    url: &str,
    url_is_users: bool,
    retries: u32,
    mut build: impl FnMut() -> Result<reqwest::RequestBuilder>,
) -> Result<String> {
    for attempt in 0..=retries {
        let resp = build()?
            .send()
            .await
            .map_err(|e| anyhow!("{}", transport_error(stage, url, &e)))?;

        let status = resp.status();
        // Recorded before anything can return: a 429 is exactly the reply that
        // says the budget is gone, so it is the most worth capturing.
        record_quota(url, resp.headers());

        if status.as_u16() == 429 && attempt < retries {
            let wait = rate_limit_delay(resp.headers(), attempt);
            tokio::time::sleep(wait).await;
            continue;
        }

        let text = resp
            .text()
            .await
            .map_err(|e| anyhow!("{}", transport_error(stage, url, &e)))?;

        if !status.is_success() {
            return Err(anyhow!(
                "{}",
                http_error_for(stage, url, status.as_u16(), &text, url_is_users)
            ));
        }

        if let Some(msg) = error_in_ok_body(&text) {
            return Err(anyhow!(
                "{}: the endpoint returned an error.\n\nIt said: {msg}\n\nCalled: {url}",
                stage.label()
            ));
        }

        return Ok(text);
    }

    unreachable!("the last attempt returns instead of looping")
}

/// How long to wait before the next attempt: what the provider asked for via
/// Retry-After when it says something sane, otherwise an exponential backoff.
/// The HTTP-date form of Retry-After fails the integer parse and falls back to
/// the backoff, which is always a safe guess.
fn rate_limit_delay(headers: &reqwest::header::HeaderMap, attempt: u32) -> Duration {
    if let Some(secs) = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
    {
        return Duration::from_secs(secs).min(MAX_RETRY_AFTER);
    }
    Duration::from_secs(1u64 << attempt.min(4))
}

/// Cleans up a hand-pasted base URL.
///
/// People paste the full endpoint they found in the provider docs, or leave
/// off the scheme, or add a trailing slash. Silently appending our path to any
/// of those produces a 404 that looks like a wrong model name, so normalise
/// first and tell the user what we actually used.
pub fn normalize_base_url(raw: &str, stage: Stage) -> Result<String> {
    let mut s = raw.trim().to_string();

    if s.is_empty() {
        return Err(anyhow!(
            "{}: no endpoint base URL is set. Add one in Settings.",
            stage.label()
        ));
    }

    if !s.starts_with("http://") && !s.starts_with("https://") {
        s = format!("https://{s}");
    }

    while s.ends_with('/') {
        s.pop();
    }

    // Strip a path we are about to append ourselves.
    for suffix in [
        "/chat/completions",
        "/audio/transcriptions",
        "/completions",
        "/speech-to-text",
        "/v1/messages",
        "/messages",
    ] {
        if let Some(stripped) = s.strip_suffix(suffix) {
            s = stripped.to_string();
        }
    }

    while s.ends_with('/') {
        s.pop();
    }

    if s.len() < "https://a.b".len() || !s[8..].contains('.') && !s.contains("localhost") {
        return Err(anyhow!(
            "{}: \"{raw}\" does not look like a URL. It should be the API base, \
             for example https://api.z.ai/api/paas/v4",
            stage.label()
        ));
    }

    Ok(s)
}

/// Turns a transport failure into something actionable. These are the cases
/// where nothing reached the server at all, so the key and the model are
/// irrelevant - it is the URL or the network.
pub fn transport_error(stage: Stage, url: &str, e: &reqwest::Error) -> String {
    let cause = if e.is_timeout() {
        "the server did not respond in time. It may be slow, blocked, or unreachable from your network."
    } else if e.is_connect() {
        "the connection could not be opened. Check the host name, and whether a firewall, VPN, or regional block is in the way."
    } else if e.is_request() {
        "the request could not be built. The URL is probably malformed."
    } else {
        "the request failed before a reply arrived."
    };

    format!(
        "{} could not reach the endpoint - {cause}\n\nCalled: {url}\n\nNothing was sent, so this is not a key problem.",
        stage.label()
    )
}

/// Turns an HTTP error status into something actionable, naming the URL so the
/// user can see whether it is the one they meant.
pub fn http_error(stage: Stage, url: &str, status: u16, body: &str) -> String {
    http_error_for(stage, url, status, body, true)
}

/// `url_is_users` distinguishes a base URL the user typed from one this app
/// builds itself. Telling someone their Gemini URL might be wrong is noise -
/// they never chose it, so on a 404 the model name is the only suspect.
pub fn http_error_for(
    stage: Stage,
    url: &str,
    status: u16,
    body: &str,
    url_is_users: bool,
) -> String {
    let detail = extract_message(body);
    let stage_label = stage.label();

    if status == 404 && !url_is_users {
        return format!(
            "{stage_label}: that model does not exist on this provider, or your account cannot \
             use it. Press \"Load available models\" next to the model field to see what this \
             key can actually reach.\n\nIt said: {detail}\n\nCalled: {url}"
        );
    }

    let explanation = match status {
        400 => format!(
            "the endpoint rejected the request as malformed. Usually the model name is wrong \
             or unsupported.\n\nIt said: {detail}"
        ),
        401 => format!(
            "the endpoint is reachable but refused the key. This is a credential problem, not \
             a URL problem - fix the {}.\n\nIt said: {detail}",
            stage.key_field()
        ),
        403 => format!(
            "the key was accepted but is not allowed to use this model or endpoint. Check the \
             plan or permissions on the provider account.\n\nIt said: {detail}"
        ),
        404 => format!(
            "nothing exists at that address. Either the base URL is wrong, or the model name \
             does not exist on this provider.\n\nIt said: {detail}"
        ),
        422 => format!("the endpoint could not process the request.\n\nIt said: {detail}"),
        429 => "the rate limit was hit. Wait a moment and try again.".to_string(),
        402 => format!(
            "the account is out of credit or has no active billing.\n\nIt said: {detail}"
        ),
        500..=599 => format!(
            "the provider is having trouble on their side ({status}). Nothing here is \
             misconfigured - try again.\n\nIt said: {detail}"
        ),
        _ => format!("it returned {status}.\n\nIt said: {detail}"),
    };

    format!("{stage_label}: {explanation}\n\nCalled: {url}")
}

/// A few providers return an error body with HTTP 200. Detect that so the
/// failure is not reported as an empty response.
pub fn error_in_ok_body(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    if v.get("error").is_some() || v.get("error_msg").is_some() {
        return Some(extract_message(body));
    }
    None
}

/// Every provider nests its message somewhere different; try the common shapes
/// before falling back to a truncated body.
pub fn extract_message(body: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        for path in [
            &v["error"]["message"],
            &v["error"]["msg"],
            &v["error"],
            &v["error_msg"],
            &v["detail"]["message"],
            &v["detail"],
            &v["message"],
            &v["msg"],
        ] {
            if let Some(s) = path.as_str() {
                if !s.trim().is_empty() {
                    return s.trim().to_string();
                }
            }
        }
    }
    let trimmed = body.trim();
    if trimmed.is_empty() {
        "(the response body was empty)".to_string()
    } else {
        trimmed.chars().take(300).collect()
    }
}
