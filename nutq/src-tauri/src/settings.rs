//! Settings, history and secrets.
//!
//! Settings and history are plain JSON under the user config dir. API keys are
//! deliberately NOT in that file - they go to the Windows Credential Manager
//! via `keyring`, so a synced or shared config folder never leaks a paid key.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "nutq";

/// Credential slots. The three named services share one key each, because the
/// same account serves both stages. The two `custom` slots are per-stage: an
/// OpenAI-compatible endpoint doing transcription is usually a different
/// service (and a different key) from one doing refinement.
pub const PROVIDER_GEMINI: &str = "gemini";
pub const PROVIDER_ANTHROPIC: &str = "anthropic";
pub const PROVIDER_ELEVENLABS: &str = "elevenlabs";
pub const PROVIDER_STT_CUSTOM: &str = "stt_custom";
pub const PROVIDER_REFINE_CUSTOM: &str = "refine_custom";

pub const ALL_PROVIDERS: [&str; 5] = [
    PROVIDER_GEMINI,
    PROVIDER_ANTHROPIC,
    PROVIDER_ELEVENLABS,
    PROVIDER_STT_CUSTOM,
    PROVIDER_REFINE_CUSTOM,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SttProvider {
    #[default]
    Gemini,
    ElevenLabs,
    /// Anything exposing `POST {base}/audio/transcriptions` - OpenAI, Groq,
    /// a local whisper server.
    OpenaiCompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RefineProvider {
    #[default]
    Anthropic,
    Gemini,
    /// Anything exposing `POST {base}/chat/completions` - GLM, DeepSeek,
    /// OpenRouter, Groq, a local llama.cpp server.
    OpenaiCompatible,
}

impl SttProvider {
    /// Which credential slot this provider reads.
    pub fn key_slot(self) -> &'static str {
        match self {
            SttProvider::Gemini => PROVIDER_GEMINI,
            SttProvider::ElevenLabs => PROVIDER_ELEVENLABS,
            SttProvider::OpenaiCompatible => PROVIDER_STT_CUSTOM,
        }
    }

    /// Cost is only tracked where the per-token rates are known.
    pub fn cost_tracked(self) -> bool {
        matches!(self, SttProvider::Gemini)
    }
}

impl RefineProvider {
    pub fn key_slot(self) -> &'static str {
        match self {
            RefineProvider::Anthropic => PROVIDER_ANTHROPIC,
            RefineProvider::Gemini => PROVIDER_GEMINI,
            RefineProvider::OpenaiCompatible => PROVIDER_REFINE_CUSTOM,
        }
    }

    pub fn cost_tracked(self) -> bool {
        !matches!(self, RefineProvider::OpenaiCompatible)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Cleaned up but faithful: filler words and false starts removed.
    #[default]
    Natural,
    /// Exactly what was said, only punctuation and spelling fixed.
    Verbatim,
    /// Rambling thought in, structured spec out.
    Spec,
    /// Bullet-point summary.
    Summary,
    /// Spoken ramble in, actionable to-do checklist out. The result is also
    /// filed in the To-do page, where items can be ticked off later.
    Checklist,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Output {
    /// Paste straight into whatever field has focus.
    Instant,
    /// Open the review window instead of pasting.
    Draft,
    /// File the result on the Notes page instead of pasting - the note's
    /// kind follows the line's processing mode.
    Notes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DictEntry {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub trigger: String,
    pub text: String,
}

/// One dictation "line": its own hotkey, its own button on the Home page,
/// and its own processing choices.
///
/// Everything a profile does not override falls through to the global
/// settings, so the common case - four lines that share one provider pair -
/// stays a matter of naming the lines and picking their keys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Profile {
    /// Stable identity, so history rows and parked jobs keep pointing at the
    /// right line after a rename or reorder.
    pub id: String,
    /// What the button and the pill call it, e.g. "Checklist".
    pub name: String,
    /// The global shortcut that starts this line's recording.
    pub hotkey: String,
    /// Where the finished text goes: pasted in place, or opened for review.
    pub output: Output,
    /// Which refinement prompt runs. Ignored when `custom_prompt` is set.
    pub mode: Mode,
    /// Non-empty means this line's own instructions replace the mode prompt
    /// entirely - the "route it through my own filter" case.
    pub custom_prompt: String,

    /// Per-line overrides for the two stages. Off means the global settings
    /// apply; on, this line runs its own provider and model.
    pub stt_override: bool,
    pub stt_provider: SttProvider,
    pub stt_model: String,
    pub refine_override: bool,
    pub refine_provider: RefineProvider,
    pub refine_model: String,
    /// This line pastes the raw transcript and skips the second API call,
    /// regardless of the global refinement toggle.
    pub refine_skip: bool,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Dictation".into(),
            hotkey: "F8".into(),
            output: Output::Instant,
            mode: Mode::Natural,
            custom_prompt: String::new(),
            stt_override: false,
            stt_provider: SttProvider::Gemini,
            stt_model: "gemini-3.5-flash".into(),
            refine_override: false,
            refine_provider: RefineProvider::Anthropic,
            refine_model: "claude-opus-5".into(),
            refine_skip: false,
        }
    }
}

impl Profile {
    fn new(id: &str, name: &str, hotkey: &str, mode: Mode, output: Output) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            hotkey: hotkey.into(),
            output,
            mode,
            ..Default::default()
        }
    }
}

/// The lines a fresh install starts with. The first four cover the paste
/// pipeline; the last two file their results on the Notes page instead.
pub fn default_profiles() -> Vec<Profile> {
    vec![
        Profile::new("dictate", "Dictation", "F8", Mode::Natural, Output::Instant),
        Profile::new("verbatim", "Proofread", "CmdOrControl+F8", Mode::Verbatim, Output::Instant),
        Profile::new("checklist", "Checklist", "CmdOrControl+F9", Mode::Checklist, Output::Instant),
        Profile::new("spec", "Idea → Spec", "CmdOrControl+F10", Mode::Spec, Output::Draft),
        Profile::new("notes", "Notes", "CmdOrControl+F11", Mode::Natural, Output::Notes),
        Profile::new("ideas", "Ideas", "CmdOrControl+F12", Mode::Spec, Output::Notes),
    ]
}

/// The two notes-filing lines, matched by id.
pub fn notes_lines() -> [Profile; 2] {
    [
        Profile::new("notes", "Notes", "CmdOrControl+F11", Mode::Natural, Output::Notes),
        Profile::new("ideas", "Ideas", "CmdOrControl+F12", Mode::Spec, Output::Notes),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub hotkey: String,
    pub draft_hotkey: String,
    pub mode: Mode,
    pub output: Output,
    pub microphone: String,

    /// Stage 1: audio to raw transcript.
    pub stt_provider: SttProvider,
    pub stt_model: String,
    /// Only read when the provider is OpenAI-compatible. No trailing slash,
    /// and it should include the version segment, e.g.
    /// `https://api.groq.com/openai/v1`.
    pub stt_base_url: String,

    /// Stage 1 failover: when the primary provider fails, this one retries
    /// the same audio before the job is parked as pending.
    pub stt_backup_enabled: bool,
    pub stt_backup_provider: SttProvider,
    pub stt_backup_model: String,

    /// Stage 2: raw transcript to finished text.
    pub refine_provider: RefineProvider,
    pub refine_model: String,
    pub refine_base_url: String,
    /// Only read when the provider is Anthropic and this is non-empty: an
    /// Anthropic-compatible service such as GLM's coding endpoint
    /// (`https://api.z.ai/api/anthropic`), spoken to with the Claude protocol.
    /// Empty means the official `https://api.anthropic.com`.
    pub refine_anthropic_base_url: String,

    /// Stage 2 failover, same idea as the stage 1 backup.
    pub refine_backup_enabled: bool,
    pub refine_backup_provider: RefineProvider,
    pub refine_backup_model: String,
    /// Turning this off pastes the raw transcript and skips the second API call.
    pub refine_enabled: bool,
    /// Nudges the transcriber. Empty means auto-detect.
    pub language_hint: String,
    pub dictionary: Vec<DictEntry>,
    pub snippets: Vec<Snippet>,
    pub play_sounds: bool,
    /// Keep the recording on disk next to its history entry so it can be
    /// played back. Off means nothing but text is ever written.
    pub save_audio: bool,

    /// The bottom-of-screen recording pill: which wave runs inside it, an
    /// optional two-part glow, and the theme that coordinates its colors.
    /// The glow's inner part lights the pill's own edges; the outer part
    /// casts light around it. Both default on and either works alone.
    pub overlay_glow_inner: bool,
    pub overlay_glow_outer: bool,
    /// Which coordinated theme is active, e.g. "teal_night" or "desert".
    /// Themes set the glow/wave color and the pill background together; the
    /// two color fields hold the active theme's values so the overlay only
    /// ever reads colors.
    pub overlay_theme: String,
    /// Hex color for the glow and the wave, e.g. "#2fd6a5" or "#ffffff".
    pub overlay_aura_color: String,
    /// Hex color behind the pill's content, e.g. "#12161d".
    pub overlay_bg: String,
    /// Which wave runs inside the pill: "bars", "ribbon", "blobs", "meter",
    /// or "ring".
    pub overlay_style: String,

    /// The dictation lines: each its own hotkey, button, and processing.
    /// An empty list is migrated to the defaults on load - either a fresh
    /// install or a settings file written before lines existed.
    pub profiles: Vec<Profile>,

    /// Not a user setting: filled in by `effective()` when a profile carries
    /// its own instructions, so the prompt builder reads one field instead of
    /// knowing about profiles. Always empty in the file on disk.
    #[serde(skip)]
    pub custom_prompt: String,

    /// Set once the notes-filing lines have been appended to an older
    /// install, so a user who deletes them is not fought at every launch.
    #[serde(default)]
    pub notes_lines_added: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: "F8".into(),
            draft_hotkey: "CmdOrControl+F8".into(),
            mode: Mode::Natural,
            output: Output::Instant,
            microphone: "Default".into(),
            stt_provider: SttProvider::Gemini,
            stt_model: "gemini-3.5-flash".into(),
            stt_base_url: "https://api.groq.com/openai/v1".into(),
            stt_backup_enabled: false,
            stt_backup_provider: SttProvider::Gemini,
            stt_backup_model: "gemini-3.5-flash".into(),
            refine_provider: RefineProvider::Anthropic,
            refine_model: "claude-opus-5".into(),
            refine_base_url: "https://open.bigmodel.cn/api/paas/v4".into(),
            refine_anthropic_base_url: String::new(),
            refine_backup_enabled: false,
            refine_backup_provider: RefineProvider::Gemini,
            refine_backup_model: "gemini-3.5-flash".into(),
            refine_enabled: true,
            // The dictation this app was designed around is Levantine Arabic
            // with English technical terms mixed in, so the hint names both.
            language_hint: "Arabic (Levantine dialect) mixed with English technical terms".into(),
            dictionary: Vec::new(),
            snippets: Vec::new(),
            play_sounds: false,
            save_audio: true,
            // The glow sits between the plain and the charged preview strengths
            // and always breathes with the voice; teal night is the identity
            // the rest of the app already speaks.
            overlay_glow_inner: true,
            overlay_glow_outer: true,
            overlay_theme: "teal_night".into(),
            overlay_aura_color: "#2fd6a5".into(),
            overlay_bg: "#12161d".into(),
            overlay_style: "bars".into(),
            profiles: default_profiles(),
            custom_prompt: String::new(),
            notes_lines_added: false,
        }
    }
}

impl Settings {
    /// The full configuration one profile's dictation actually runs under:
    /// the globals, with the profile's own choices laid over them.
    ///
    /// The pipeline keeps taking a `Settings`, so nothing below this point
    /// had to learn that profiles exist - a line that overrides nothing
    /// produces a clone of the globals with its mode and output, and one
    /// that overrides a stage swaps in its own provider and model.
    pub fn effective(&self, p: &Profile) -> Settings {
        let mut c = self.clone();
        c.mode = p.mode;
        c.output = p.output;
        c.custom_prompt = p.custom_prompt.clone();
        if p.stt_override {
            c.stt_provider = p.stt_provider;
            c.stt_model = p.stt_model.clone();
        }
        if p.refine_override {
            c.refine_provider = p.refine_provider;
            c.refine_model = p.refine_model.clone();
        }
        if p.refine_skip {
            c.refine_enabled = false;
        }
        c
    }

    /// A profile by id, falling back to the first line - the one a call with
    /// no id (or one pointing at a deleted line) should land on.
    pub fn profile(&self, id: &str) -> Profile {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .or_else(|| self.profiles.first().cloned())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub at: String,
    pub mode: Mode,
    pub raw: String,
    pub refined: String,
    pub seconds: f32,
    pub cost_usd: f64,
    /// Which model actually did each stage - when the primary failed, the
    /// backup's name is recorded here. Empty refine_model means refinement
    /// did not run (or failed and fell back to the raw transcript).
    #[serde(default)]
    pub stt_model: String,
    #[serde(default)]
    pub stt_via_backup: bool,
    #[serde(default)]
    pub refine_model: String,
    #[serde(default)]
    pub refine_via_backup: bool,
    /// The microphone the audio actually came from, resolved at capture time -
    /// "Default" in Settings can be a different device from one day to the next.
    #[serde(default)]
    pub microphone: String,
    /// File name of the kept recording inside the clips directory, when audio
    /// was saved and has not aged out yet.
    #[serde(default)]
    pub audio_file: Option<String>,
    /// Which dictation line produced this. Entries that predate lines carry
    /// an empty name and simply show no badge.
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub profile_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct History {
    pub entries: Vec<HistoryEntry>,
}

impl History {
    /// Newest first, capped so the file cannot grow without bound.
    pub fn push(&mut self, entry: HistoryEntry) {
        self.entries.insert(0, entry);
        self.entries.truncate(500);
    }

    pub fn month_total(&self) -> f64 {
        let prefix = chrono::Local::now().format("%Y-%m").to_string();
        self.entries
            .iter()
            .filter(|e| e.at.starts_with(&prefix))
            .map(|e| e.cost_usd)
            .sum()
    }

    /// Finished dictations today, and the audio they carried.
    ///
    /// Groq bills Whisper by seconds of audio rather than by request, so the
    /// seconds are the figure that actually matters against that allowance -
    /// a count of dictations says nothing about a 30-second one versus a
    /// 2-second one.
    pub fn today_totals(&self) -> (usize, f32) {
        let prefix = chrono::Local::now().format("%Y-%m-%d").to_string();
        let today = self.entries.iter().filter(|e| e.at.starts_with(&prefix));
        let mut count = 0usize;
        let mut seconds = 0.0f32;
        for e in today {
            count += 1;
            seconds += e.seconds;
        }
        (count, seconds)
    }

    pub fn month_count(&self) -> usize {
        let prefix = chrono::Local::now().format("%Y-%m").to_string();
        self.entries.iter().filter(|e| e.at.starts_with(&prefix)).count()
    }
}

pub(crate) fn config_dir() -> Result<PathBuf> {
    let dirs = directories::ProjectDirs::from("com", "nutq", "nutq")
        .ok_or_else(|| anyhow!("could not resolve a config directory"))?;
    let dir = dirs.config_dir().to_path_buf();
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn settings_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("settings.json"))
}

fn usage_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("usage.json"))
}

/// A running count of requests actually sent to each host, for one day.
///
/// This exists because a provider's own `remaining` figure answers a different
/// question than the one users ask. Groq refills continuously - one request
/// every 43.2 seconds against a 2000/day allowance - so its counter drifts back
/// to full within minutes and can never say "how much have I used today". That
/// total is ours to keep, so we keep it.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DailyUsage {
    /// Local date these counts belong to; a different date resets them.
    pub date: String,
    /// Host -> requests sent today.
    pub hosts: std::collections::BTreeMap<String, u32>,
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn load_daily_usage() -> DailyUsage {
    let mut u: DailyUsage = usage_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    // Rolling over at midnight is what makes this a *daily* figure rather than
    // an ever-growing one, and it has to happen on read as well as on write -
    // the app is often left running across the boundary.
    if u.date != today() {
        u = DailyUsage {
            date: today(),
            hosts: Default::default(),
        };
    }
    u
}

/// Records one request to `host`. Called for every reply the app receives, so
/// it counts retries and failed attempts too - they consume allowance just the
/// same, which is precisely why the provider's figure and a count of finished
/// dictations disagree.
pub fn bump_daily_request(host: &str) {
    let mut u = load_daily_usage();
    *u.hosts.entry(host.to_string()).or_insert(0) += 1;
    if let Ok(p) = usage_path() {
        let _ = fs::write(p, serde_json::to_string_pretty(&u).unwrap_or_default());
    }
}

fn history_path() -> Result<PathBuf> {
    Ok(config_dir()?.join("history.json"))
}

/// A corrupt or partial file must not brick the app - fall back to defaults.
///
/// A settings file from before the lines existed carries no `profiles`, so
/// the old single hotkey and mode become the first line and the old review
/// hotkey becomes a second one - nothing the user had configured is lost,
/// and the other two defaults fill in behind them. Saved back immediately so
/// the migration happens exactly once.
pub fn load_settings() -> Settings {
    let mut s: Settings = settings_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if s.profiles.is_empty() {
        let mut profiles = default_profiles();
        if !s.hotkey.trim().is_empty() {
            profiles[0].hotkey = s.hotkey.clone();
        }
        profiles[0].mode = s.mode;
        profiles[0].output = s.output;
        if !s.draft_hotkey.trim().is_empty() {
            profiles[1].hotkey = s.draft_hotkey.clone();
        }
        profiles[1].mode = s.mode;
        profiles[1].output = Output::Draft;
        profiles[1].name = "Proofread".into();
        s.profiles = profiles;
        let _ = save_settings(&s);
    }

    // An install from before the Notes page existed has no notes-filing
    // lines; append them once. The flag, not their presence, is what keeps
    // a deleted line from coming back on every launch.
    if !s.notes_lines_added {
        for p in notes_lines() {
            if !s.profiles.iter().any(|e| e.id == p.id) {
                s.profiles.push(p);
            }
        }
        s.notes_lines_added = true;
        let _ = save_settings(&s);
    }
    s
}

pub fn save_settings(s: &Settings) -> Result<()> {
    fs::write(settings_path()?, serde_json::to_string_pretty(s)?)?;
    Ok(())
}

pub fn load_history() -> History {
    history_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_history(h: &History) -> Result<()> {
    fs::write(history_path()?, serde_json::to_string_pretty(h)?)?;
    Ok(())
}

fn entry(provider: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(KEYRING_SERVICE, provider)?)
}

pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    if key.trim().is_empty() {
        // Empty means "forget it"; a missing entry is not an error here.
        let _ = entry(provider)?.delete_credential();
        return Ok(());
    }
    entry(provider)?.set_password(key.trim())?;
    Ok(())
}

/// The slot names are internal; error messages name the Settings field instead.
fn slot_label(provider: &str) -> &str {
    match provider {
        PROVIDER_GEMINI => "Gemini",
        PROVIDER_ANTHROPIC => "Claude",
        PROVIDER_ELEVENLABS => "ElevenLabs",
        PROVIDER_STT_CUSTOM => "Transcription endpoint",
        PROVIDER_REFINE_CUSTOM => "Refinement endpoint",
        other => other,
    }
}

pub fn get_api_key(provider: &str) -> Result<String> {
    let key = entry(provider)?.get_password().map_err(|_| {
        anyhow!(
            "No API key is saved for \"{}\". Open Settings, put the key in that field, and \
             press Save changes.",
            slot_label(provider)
        )
    })?;

    if key.trim().is_empty() {
        return Err(anyhow!(
            "The saved \"{}\" key is blank. Re-enter it in Settings.",
            slot_label(provider)
        ));
    }
    Ok(key)
}

pub fn has_api_key(provider: &str) -> bool {
    entry(provider).and_then(|e| Ok(e.get_password()?)).is_ok()
}
