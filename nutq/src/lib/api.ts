import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { check as pluginCheck } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { mockInvoke, useMock } from "./devMock";

/** Real Tauri command, or the dev mock when running in a plain browser. */
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return useMock() ? mockInvoke<T>(cmd, args) : tauriInvoke<T>(cmd, args);
}

function listen<T>(event: string, fn: (e: { payload: T }) => void): Promise<UnlistenFn> {
  return useMock() ? Promise.resolve(() => {}) : tauriListen<T>(event, fn);
}

export type Mode = "natural" | "verbatim" | "spec" | "summary" | "checklist";
export type Output = "instant" | "draft" | "notes";
export type Status = "idle" | "recording" | "transcribing" | "refining";
/** The wave shape that runs inside the recording pill. */
export type OverlayStyle = "bars" | "ribbon" | "blobs" | "meter" | "ring";
/** What sits at the head of the pill: the recording line's own glyph, the
 *  classic red dot, or nothing at all. */
export type OverlayIndicator = "icon" | "dot" | "none";
/** How the main window paints itself. "system" follows Windows. */
export type Theme = "system" | "light" | "dark";

export interface DictEntry {
  from: string;
  to: string;
}

export interface Snippet {
  trigger: string;
  text: string;
}

/** One dictation line: its own hotkey, button, and processing choices.
 *  Fields the line does not override fall through to the globals. */
export interface Profile {
  id: string;
  name: string;
  hotkey: string;
  output: Output;
  mode: Mode;
  /** Non-empty replaces the mode prompt entirely. */
  custom_prompt: string;
  stt_override: boolean;
  stt_provider: SttProvider;
  stt_model: string;
  refine_override: boolean;
  refine_provider: RefineProvider;
  refine_model: string;
  refine_skip: boolean;
}

export type SttProvider = "gemini" | "eleven_labs" | "openai_compatible";
export type RefineProvider = "anthropic" | "gemini" | "openai_compatible";

export interface Settings {
  hotkey: string;
  draftHotkey: string;
  mode: Mode;
  output: Output;
  microphone: string;
  sttProvider: SttProvider;
  sttModel: string;
  sttBaseUrl: string;
  sttBackupEnabled: boolean;
  sttBackupProvider: SttProvider;
  sttBackupModel: string;
  refineProvider: RefineProvider;
  refineModel: string;
  refineBaseUrl: string;
  /** Anthropic-compatible base for the Claude provider; empty = official API. */
  refineAnthropicBaseUrl: string;
  refineBackupEnabled: boolean;
  refineBackupProvider: RefineProvider;
  refineBackupModel: string;
  refineEnabled: boolean;
  languageHint: string;
  dictionary: DictEntry[];
  snippets: Snippet[];
  playSounds: boolean;
  /** Keep each recording on disk so it can be replayed from History. */
  saveAudio: boolean;
  /** Light, dark, or whatever Windows is set to. */
  theme: Theme;
  /** The recording pill: which wave runs inside it, the two-part glow, and
   *  the coordinated theme behind its colors. */
  overlayGlowInner: boolean;
  overlayGlowOuter: boolean;
  overlayTheme: string;
  overlayAuraColor: string;
  overlayBg: string;
  overlayStyle: OverlayStyle;
  overlayIndicator: OverlayIndicator;
  /** Write the line's name inside the pill as well as its icon. */
  overlayShowName: boolean;
  profiles: Profile[];
}

/** The Rust structs are snake_case on the wire; the UI speaks camelCase. */
interface RawSettings {
  hotkey: string;
  draft_hotkey: string;
  mode: Mode;
  output: Output;
  microphone: string;
  stt_provider: SttProvider;
  stt_model: string;
  stt_base_url: string;
  stt_backup_enabled: boolean;
  stt_backup_provider: SttProvider;
  stt_backup_model: string;
  refine_provider: RefineProvider;
  refine_model: string;
  refine_base_url: string;
  refine_anthropic_base_url: string;
  refine_backup_enabled: boolean;
  refine_backup_provider: RefineProvider;
  refine_backup_model: string;
  refine_enabled: boolean;
  language_hint: string;
  dictionary: DictEntry[];
  snippets: Snippet[];
  play_sounds: boolean;
  save_audio: boolean;
  theme: Theme;
  overlay_glow_inner: boolean;
  overlay_glow_outer: boolean;
  overlay_theme: string;
  overlay_aura_color: string;
  overlay_bg: string;
  overlay_style: OverlayStyle;
  overlay_indicator: OverlayIndicator;
  overlay_show_name: boolean;
  profiles: Profile[];
}

const toUi = (r: RawSettings): Settings => ({
  hotkey: r.hotkey,
  draftHotkey: r.draft_hotkey,
  mode: r.mode,
  output: r.output,
  microphone: r.microphone,
  sttProvider: r.stt_provider,
  sttModel: r.stt_model,
  sttBaseUrl: r.stt_base_url,
  sttBackupEnabled: r.stt_backup_enabled,
  sttBackupProvider: r.stt_backup_provider,
  sttBackupModel: r.stt_backup_model,
  refineProvider: r.refine_provider,
  refineModel: r.refine_model,
  refineBaseUrl: r.refine_base_url,
  refineAnthropicBaseUrl: r.refine_anthropic_base_url,
  refineBackupEnabled: r.refine_backup_enabled,
  refineBackupProvider: r.refine_backup_provider,
  refineBackupModel: r.refine_backup_model,
  refineEnabled: r.refine_enabled,
  languageHint: r.language_hint,
  dictionary: r.dictionary,
  snippets: r.snippets,
  playSounds: r.play_sounds,
  saveAudio: r.save_audio,
  theme: r.theme ?? "system",
  overlayGlowInner: r.overlay_glow_inner,
  overlayGlowOuter: r.overlay_glow_outer,
  overlayTheme: r.overlay_theme,
  overlayAuraColor: r.overlay_aura_color,
  overlayBg: r.overlay_bg,
  overlayStyle: r.overlay_style,
  overlayIndicator: r.overlay_indicator ?? "icon",
  overlayShowName: r.overlay_show_name ?? false,
  profiles: r.profiles ?? [],
});

const toRust = (s: Settings): RawSettings => ({
  hotkey: s.hotkey,
  draft_hotkey: s.draftHotkey,
  mode: s.mode,
  output: s.output,
  microphone: s.microphone,
  stt_provider: s.sttProvider,
  stt_model: s.sttModel,
  stt_base_url: s.sttBaseUrl,
  stt_backup_enabled: s.sttBackupEnabled,
  stt_backup_provider: s.sttBackupProvider,
  stt_backup_model: s.sttBackupModel,
  refine_provider: s.refineProvider,
  refine_model: s.refineModel,
  refine_base_url: s.refineBaseUrl,
  refine_anthropic_base_url: s.refineAnthropicBaseUrl,
  refine_backup_enabled: s.refineBackupEnabled,
  refine_backup_provider: s.refineBackupProvider,
  refine_backup_model: s.refineBackupModel,
  refine_enabled: s.refineEnabled,
  language_hint: s.languageHint,
  dictionary: s.dictionary,
  snippets: s.snippets,
  play_sounds: s.playSounds,
  save_audio: s.saveAudio,
  theme: s.theme,
  overlay_glow_inner: s.overlayGlowInner,
  overlay_glow_outer: s.overlayGlowOuter,
  overlay_theme: s.overlayTheme,
  overlay_aura_color: s.overlayAuraColor,
  overlay_bg: s.overlayBg,
  overlay_style: s.overlayStyle,
  overlay_indicator: s.overlayIndicator,
  overlay_show_name: s.overlayShowName,
  profiles: s.profiles,
});

export interface HistoryEntry {
  id: string;
  at: string;
  mode: Mode;
  raw: string;
  refined: string;
  seconds: number;
  cost_usd: number;
  /** Which model actually did each stage; absent on older entries. */
  stt_model?: string;
  stt_via_backup?: boolean;
  refine_model?: string;
  refine_via_backup?: boolean;
  /** The microphone the audio actually came from; absent on older entries. */
  microphone?: string;
  /** Set when the recording was kept and is still on disk. */
  audio_file?: string | null;
  /** Which dictation line produced this; empty on older entries. */
  profile?: string;
  profile_id?: string;
}

export interface ResultPayload {
  refined: string;
  mode: Mode;
  output: Output;
  seconds: number;
  cost_usd: number;
}

/** One budget a provider reports, in whatever unit it bills by. */
export interface QuotaItem {
  /** The provider's own name for it, e.g. "audio-seconds" or "requests". */
  kind: string;
  limit: string;
  remaining: string;
  /** Time until it refills, as reported: "7.66s", "2m59.56s". */
  reset: string;
}

/** One provider's last reported budget. Keyed by host, so the primary and the
 *  backup each get their own reading instead of overwriting one another. */
export interface Quota {
  host: string;
  at: string;
  /** Requests this app sent to this host since it started - a cross-check
   *  against the provider's own count. */
  sent_this_session: number;
  /** Requests sent to this host today, across restarts - the running total a
   *  refilling provider allowance cannot report. */
  sent_today: number;
  items: QuotaItem[];
}

export interface Usage {
  month_cost: number;
  month_count: number;
  today_count: number;
  today_audio_seconds: number;
  cost_complete: boolean;
}

/** The chart's range filters. "day" is hour-by-hour for today; the rest are
 *  trailing windows of whole days ending today. */
export type UsageRange = "day" | "week" | "month" | "quarter";

/** One model's share of a usage bucket, for the stacked bar segments. */
export interface UsageSlice {
  /** STT model name; "unknown" on entries that predate model tracking. */
  model: string;
  count: number;
  seconds: number;
}

/** One bar of the usage chart: an hour of today or a whole day. */
export interface UsageBucket {
  /** "HH:00" for the day range, "YYYY-MM-DD" otherwise. */
  label: string;
  count: number;
  seconds: number;
  /** The same two numbers split per STT model. */
  models: UsageSlice[];
}

/** A failed call parked for retry: audio (stage 1) or transcript (stage 2). */
export interface PendingEntry {
  id: string;
  created_at: string;
  stage: "transcription" | "refinement" | string;
  error: string;
  seconds: number;
  mode: Mode;
  output: Output;
  microphone?: string;
  wav_file: string | null;
  transcript: string | null;
}

/** One filed warning or error, newest first in the list. */
export interface LogEntry {
  id: string;
  at: string;
  level: "warning" | "error";
  message: string;
}

/** Credential slot name -> whether a key is saved for it. */
export type KeyStatus = Record<string, boolean>;

/** Which credential slot each provider reads. Mirrors `key_slot()` in Rust. */
export const STT_KEY_SLOT: Record<SttProvider, string> = {
  gemini: "gemini",
  eleven_labs: "elevenlabs",
  openai_compatible: "stt_custom",
};

export const REFINE_KEY_SLOT: Record<RefineProvider, string> = {
  anthropic: "anthropic",
  gemini: "gemini",
  openai_compatible: "refine_custom",
};

export const STT_PROVIDERS: {
  id: SttProvider;
  name: string;
  hint: string;
  models: string[];
  custom: boolean;
}[] = [
  {
    id: "gemini",
    name: "Gemini",
    hint: "Best on Levantine Arabic mixed with English. Takes audio directly.",
    models: ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-3.5-flash-lite"],
    custom: false,
  },
  {
    id: "eleven_labs",
    name: "ElevenLabs Scribe",
    hint: "Purpose-built transcriber, strong multilingual accuracy.",
    models: ["scribe_v1"],
    custom: false,
  },
  {
    id: "openai_compatible",
    name: "Any OpenAI-compatible endpoint",
    hint: "POST {base}/audio/transcriptions — OpenAI, Groq, a local whisper server.",
    models: [],
    custom: true,
  },
];

export const REFINE_PROVIDERS: {
  id: RefineProvider;
  name: string;
  hint: string;
  models: string[];
  custom: boolean;
}[] = [
  {
    id: "anthropic",
    name: "Claude",
    hint:
      "The official Anthropic API, or an Anthropic-compatible base URL (GLM's coding endpoint).",
    models: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
    custom: false,
  },
  {
    id: "gemini",
    name: "Gemini",
    hint: "Reuses the Gemini key, so one provider covers both stages.",
    models: ["gemini-3.5-flash", "gemini-3.5-pro"],
    custom: false,
  },
  {
    id: "openai_compatible",
    name: "Any OpenAI-compatible endpoint",
    hint: "POST {base}/chat/completions — GLM, DeepSeek, OpenRouter, Groq, local servers.",
    models: [],
    custom: true,
  },
];

/**
 * Shown under the endpoint field so the URL shape is not a guessing game.
 *
 * GLM is listed twice on purpose: Zhipu runs a mainland-China endpoint and an
 * international one, each with its own accounts and keys. A key issued for one
 * is rejected by the other with a plain 401, which reads exactly like a bad
 * key — so the international host is listed first, being the one most accounts
 * outside China are actually on.
 */
export const ENDPOINT_EXAMPLES = [
  { name: "GLM · international", url: "https://api.z.ai/api/paas/v4" },
  { name: "GLM · China", url: "https://open.bigmodel.cn/api/paas/v4" },
  { name: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "Groq", url: "https://api.groq.com/openai/v1" },
  { name: "OpenAI", url: "https://api.openai.com/v1" },
];

/**
 * Claude-protocol bases for services that are not Anthropic but speak its
 * Messages API. The GLM coding plan key only works here - pasting it at the
 * official endpoint is the classic "invalid x-api-key" surprise.
 */
export const ANTHROPIC_BASE_EXAMPLES = [
  { name: "GLM · coding plan", url: "https://api.z.ai/api/anthropic" },
];

/** What one binding is actually doing right now. */
export interface HotkeyState {
  spec: string;
  bound: boolean;
  error: string;
  /** Non-empty when this was reset at startup because the saved spec was unusable. */
  reset_from: string;
}

/** One line's binding, in settings order. */
export interface HotkeySlot {
  profile_id: string;
  name: string;
  state: HotkeyState;
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export const api = {
  async getSettings(): Promise<Settings> {
    return toUi(await invoke<RawSettings>("get_settings"));
  },
  async saveSettings(s: Settings): Promise<void> {
    return invoke("update_settings", { next: toRust(s) });
  },
  setApiKey: (provider: string, key: string) =>
    invoke<void>("set_api_key", { provider, key }),
  keyStatus: () => invoke<KeyStatus>("key_status"),
  listMicrophones: () => invoke<string[]>("list_microphones"),
  /** Validates a hotkey spec without binding it. Rejects with the reason. */
  checkHotkey: (spec: string) => invoke<void>("check_hotkey", { spec }),
  /** Whether each hotkey is actually bound, and what went wrong if not. */
  hotkeyStatus: () => invoke<HotkeySlot[]>("hotkey_status"),
  getHistory: () => invoke<HistoryEntry[]>("get_history"),
  /** Newest entry only - what the home page shows as the last result. */
  getLatest: () => invoke<HistoryEntry | null>("get_latest"),
  /** The kept recording for one entry, base64 wav. Rejects when it is gone. */
  getHistoryAudio: (id: string) => invoke<string>("get_history_audio", { id }),
  clearHistory: () => invoke<void>("clear_history"),
  /** Removes one entry and its recording. */
  deleteHistoryEntry: (id: string) => invoke<void>("delete_history_entry", { id }),
  /** Re-runs a saved entry through the providers selected in Settings right
   *  now - the full pipeline from the kept audio when the recording still
   *  exists, refinement-only over the saved transcript otherwise - updating
   *  that entry in place. Returns the updated entry. Rejects with the
   *  reason on failure, leaving the entry unchanged. */
  regenerateHistoryEntry: (id: string) => invoke<HistoryEntry>("regenerate_history_entry", { id }),
  /** Usage buckets for the selected chart range: hours of today, or whole
   *  days for week/month/quarter. */
  getHistoryStats: (range: UsageRange) => invoke<UsageBucket[]>("get_history_stats", { range }),
  getUsage: () => invoke<Usage>("get_usage"),
  /** Allowance left on each provider's key, read from reply headers. */
  getQuota: () => invoke<Quota[]>("get_quota"),
  copyText: (text: string) => invoke<void>("copy_text", { text }),
  getStatus: () => invoke<Status>("get_status"),
  /** Starts or stops recording on one dictation line. Absent falls back to
   *  the first line. */
  toggle: (profile?: string) => invoke<void>("toggle", { profile }),
  /** Runs one real request against a stage's provider. `stage` is "stt" | "refine". */
  testProvider: (stage: "stt" | "refine") =>
    invoke<TestResult>("test_provider", { stage }),
  /** Model names this key can actually reach. Rejects with a diagnostic string. */
  listModels: (stage: "stt" | "refine") => invoke<string[]>("list_models", { stage }),
  getPending: () => invoke<PendingEntry[]>("get_pending"),
  retryPending: (id: string) => invoke<void>("retry_pending", { id }),
  discardPending: (id: string) => invoke<void>("discard_pending", { id }),
  /** Persistent warnings/errors, newest first. */
  getLogs: () => invoke<LogEntry[]>("get_logs"),
  clearLogs: () => invoke<void>("clear_logs"),
  /** The checklist line's output: to-do lists, newest first. */
  getTodos: () => invoke<TodoList[]>("get_todos"),
  toggleTodo: (id: string, index: number) => invoke<void>("toggle_todo", { id, index }),
  addTodoItem: (id: string, text: string) => invoke<void>("add_todo_item", { id, text }),
  removeTodoItem: (id: string, index: number) => invoke<void>("remove_todo_item", { id, index }),
  deleteTodoList: (id: string) => invoke<void>("delete_todo_list", { id }),
  /** The Notes page's contents, newest first. */
  getNotes: () => invoke<Note[]>("get_notes"),
  updateNote: (id: string, text: string) => invoke<void>("update_note", { id, text }),
  setNoteKind: (id: string, kind: NoteKind) => invoke<void>("set_note_kind", { id, kind }),
  deleteNote: (id: string) => invoke<void>("delete_note", { id }),
  /** Diagnostics: reports the overlay webview is alive and what it sees. */
  overlayAlive: (status: string) => invoke<void>("overlay_alive", { status }),
  /** Proof from the overlay page that its window is being composited: sent
   *  from a requestAnimationFrame loop, which only ticks while frames are
   *  actually being produced for the pill's window. Rust watches it, with the
   *  state poll, and repairs the window if the pill stops drawing. */
  overlayFrame: () => invoke<void>("overlay_frame"),
  /** Status + live mic level + the pill's personalization in one call, for
   *  the overlay's poll loop. */
  overlayState: () =>
    invoke<{
      status: Status;
      level: number;
      style: OverlayStyle;
      glow_inner: boolean;
      glow_outer: boolean;
      aura_color: string;
      bg: string;
      label: string;
      /** The recording line's kind: "mic", "note", "idea", "checklist",
       *  "summary", "verbatim" or "custom". */
      kind: string;
      indicator: OverlayIndicator;
      show_name: boolean;
    }>("overlay_state"),
  /** Asks GitHub (via the updater plugin) whether a newer release exists.
   *  Null when this is the latest. Rejects when offline - callers treat
   *  that as "nothing to say", not as an error worth showing. */
  async checkForUpdate(): Promise<{ version: string; notes: string } | null> {
    const u = await pluginCheck();
    return u ? { version: u.version, notes: u.body ?? "" } : null;
  },
  /** Downloads the signed installer from the release, verifies it against
   *  the public key in tauri.conf.json, runs it, and relaunches the app -
   *  the whole in-app upgrade path. Rejects with the reason if any step
   *  fails, leaving the current install untouched. */
  async installUpdate(): Promise<void> {
    const u = await pluginCheck();
    if (!u) throw new Error("the update is gone - check again");
    await u.downloadAndInstall();
    await relaunch();
  },
};

export const events = {
  onStatus: (fn: (s: Status) => void): Promise<UnlistenFn> =>
    listen<Status>("status", (e) => fn(e.payload)),
  onResult: (fn: (r: ResultPayload) => void): Promise<UnlistenFn> =>
    listen<ResultPayload>("result", (e) => fn(e.payload)),
  onError: (fn: (m: string) => void): Promise<UnlistenFn> =>
    listen<string>("error", (e) => fn(e.payload)),
  onWarning: (fn: (m: string) => void): Promise<UnlistenFn> =>
    listen<string>("warning", (e) => fn(e.payload)),
  /** Live mic loudness (RMS 0..1), ~30 Hz while recording. */
  onLevel: (fn: (v: number) => void): Promise<UnlistenFn> =>
    listen<number>("level", (e) => fn(e.payload)),
  /** The pending-retry list changed: a job was added, finished, or dropped. */
  onPendingChanged: (fn: () => void): Promise<UnlistenFn> =>
    listen<null>("pending-changed", () => fn()),
};

export const MODE_LABELS: Record<Mode, { name: string; hint: string }> = {
  natural: { name: "Natural", hint: "Filler and false starts removed" },
  verbatim: { name: "Verbatim", hint: "Exactly as spoken, punctuation fixed" },
  spec: { name: "Spec", hint: "Rambling idea to a structured brief" },
  summary: { name: "Summary", hint: "Tight bullet points" },
  checklist: { name: "Checklist", hint: "Spoken ramble to a tickable to-do list" },
};

/** A blank line for "+ Add line", with a fresh id. */
export function newProfile(index: number): Profile {
  return {
    id: `line-${Date.now().toString(36)}-${index}`,
    name: `Line ${index + 1}`,
    hotkey: `CmdOrControl+F${9 + index}`,
    output: "instant",
    mode: "natural",
    custom_prompt: "",
    stt_override: false,
    stt_provider: "gemini",
    stt_model: "gemini-3.5-flash",
    refine_override: false,
    refine_provider: "anthropic",
    refine_model: "claude-opus-5",
    refine_skip: false,
  };
}

/** One to-do item of a checklist dictation. */
export interface TodoItem {
  text: string;
  done: boolean;
}

  /** One filed checklist: the To-do page's unit. */
export interface TodoList {
  id: string;
  at: string;
  title: string;
  items: TodoItem[];
}

/** What a note on the Notes page is: the property that decides its section
 *  and badge. */
export type NoteKind = "cleaned" | "verbatim" | "idea";

/** One filed note or idea. */
export interface Note {
  id: string;
  at: string;
  kind: NoteKind;
  title: string;
  text: string;
  profile?: string;
}
