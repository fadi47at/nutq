import { useEffect, useState } from "react";
import {
  api,
  ANTHROPIC_BASE_EXAMPLES,
  ENDPOINT_EXAMPLES,
  MODE_LABELS,
  REFINE_KEY_SLOT,
  REFINE_PROVIDERS,
  STT_KEY_SLOT,
  STT_PROVIDERS,
  newProfile,
  type HotkeySlot,
  type HotkeyState,
  type KeyStatus,
  type OverlayIndicator,
  type OverlayStyle,
  type Profile,
  type RefineProvider,
  type Settings,
  type SttProvider,
  type TestResult,
  type Theme,
} from "../lib/api";
import { specFromEvent } from "../lib/hotkeys";
import {
  Field,
  Icon,
  Kbd,
  KIND_NAME,
  lineIcon,
  lineKind,
  PageHead,
  Toggle,
  type IconName,
} from "../lib/ui";
import PillPreview from "./PillPreview";

interface Props {
  settings: Settings;
  keys: KeyStatus;
  onSave: (next: Settings) => Promise<void>;
  /** Try a theme on without saving it. Null hands the window back to the
   *  saved setting. */
  onPreviewTheme: (theme: Theme | null) => void;
}

/** Label under each key field, so slots are named the same way everywhere. */
const KEY_FIELDS: { slot: string; name: string; where: string; placeholder: string }[] = [
  { slot: "gemini", name: "Gemini", where: "aistudio.google.com", placeholder: "AIza..." },
  { slot: "anthropic", name: "Claude", where: "console.anthropic.com", placeholder: "sk-ant-..." },
  { slot: "elevenlabs", name: "ElevenLabs", where: "elevenlabs.io", placeholder: "sk_..." },
  {
    slot: "stt_custom",
    name: "Transcription endpoint",
    where: "your OpenAI-compatible transcription service",
    placeholder: "key for the endpoint below",
  },
  {
    slot: "refine_custom",
    name: "Refinement endpoint",
    where: "your OpenAI-compatible chat service",
    placeholder: "key for the endpoint below",
  },
];

type SectionId =
  | "lines"
  | "words"
  | "stt"
  | "refine"
  | "keys"
  | "capture"
  | "overlay"
  | "appearance";

/**
 * The section list, in three groups.
 *
 * A seven-name tab strip gave every group the same weight and pushed the last
 * two off the edge of a narrow window. Grouping them says what the app is made
 * of: the lines you speak on, the engine behind them, and the program itself.
 */
const SECTIONS: { group: string; items: { id: SectionId; name: string; icon: IconName }[] }[] = [
  {
    group: "Dictation",
    items: [
      { id: "lines", name: "Lines", icon: "bolt" },
      { id: "words", name: "Vocabulary", icon: "book" },
    ],
  },
  {
    group: "Engine",
    items: [
      { id: "stt", name: "Transcription", icon: "mic" },
      { id: "refine", name: "Refinement", icon: "chat" },
      { id: "keys", name: "API keys", icon: "key" },
    ],
  },
  {
    group: "Application",
    items: [
      { id: "capture", name: "Audio & input", icon: "sliders" },
      { id: "overlay", name: "Recording pill", icon: "wave" },
      { id: "appearance", name: "Appearance", icon: "palette" },
    ],
  },
];

/** Where a line's finished text goes. */
const OUTPUTS: { id: Profile["output"]; name: string; hint: string }[] = [
  { id: "instant", name: "Paste it", hint: "straight into whatever field has focus" },
  { id: "draft", name: "Show it here", hint: "opens nutq with the text, nothing is pasted" },
  { id: "notes", name: "File a note", hint: "lands on the Notes page instead" },
];

/** The wave shapes that can run inside the recording pill. */
const OVERLAY_STYLES: { id: OverlayStyle; name: string; hint: string }[] = [
  { id: "bars", name: "Bars", hint: "The classic dancing columns" },
  { id: "ribbon", name: "Breathing band", hint: "A soft band that swells with your voice" },
  { id: "blobs", name: "Syllables", hint: "One block per spoken syllable, gaps for pauses" },
  { id: "meter", name: "Level meter", hint: "A gradient bar with a peak-hold marker" },
  { id: "ring", name: "Pulse", hint: "Rings around the dot, no wave at all" },
];

/** Coordinated colour themes for the pill, in two families.
 *
 * One pick sets the glow-and-wave colour and the background together, so the
 * result always matches: a wave picked on its own against a background picked
 * on its own is how you end up with a pill you cannot read. The Day family
 * keeps the wave dark enough to carry on a pale pill. */
const OVERLAY_THEMES: { group: string; items: { id: string; name: string; aura: string; bg: string }[] }[] = [
  {
    group: "Night",
    items: [
      { id: "teal_night", name: "Teal Night", aura: "#2fd6a5", bg: "#12161d" },
      { id: "emerald", name: "Emerald", aura: "#34d399", bg: "#0d1a14" },
      { id: "matrix", name: "Matrix", aura: "#22c55e", bg: "#05100a" },
      { id: "lime", name: "Lime", aura: "#a3e635", bg: "#121a0d" },
      { id: "cyan", name: "Cyan", aura: "#22d3ee", bg: "#0b1a20" },
      { id: "frost", name: "Frost", aura: "#9be8e0", bg: "#101820" },
      { id: "ocean", name: "Ocean", aura: "#4aa8ff", bg: "#0e1520" },
      { id: "indigo", name: "Indigo", aura: "#818cf8", bg: "#0d1020" },
      { id: "violet", name: "Violet", aura: "#a78bfa", bg: "#151021" },
      { id: "magenta", name: "Magenta", aura: "#f472d0", bg: "#1a0f1a" },
      { id: "rose", name: "Rose", aura: "#ff7d9c", bg: "#1c1218" },
      { id: "crimson", name: "Crimson", aura: "#ef6b6b", bg: "#1a0f0f" },
      { id: "ember", name: "Ember", aura: "#ff7a45", bg: "#1b1008" },
      { id: "amber", name: "Amber", aura: "#f59e0b", bg: "#1a120a" },
      { id: "gold", name: "Gold", aura: "#ffd166", bg: "#17130a" },
      { id: "desert", name: "Desert", aura: "#e8b45a", bg: "#1d1712" },
      { id: "steel", name: "Steel", aura: "#cbd5e1", bg: "#0f141b" },
      { id: "carbon", name: "Carbon", aura: "#ffffff", bg: "#000000" },
    ],
  },
  {
    group: "Day",
    items: [
      { id: "pure_day", name: "Pure Day", aura: "#0f9d8f", bg: "#f3f6f8" },
      { id: "day_mint", name: "Day Mint", aura: "#0e8a63", bg: "#eefaf3" },
      { id: "day_sky", name: "Day Sky", aura: "#1668c9", bg: "#eef4fc" },
      { id: "day_ocean", name: "Day Ocean", aura: "#0b6fb0", bg: "#eaf6ff" },
      { id: "day_lilac", name: "Day Lilac", aura: "#6d4aff", bg: "#f2efff" },
      { id: "day_blossom", name: "Day Blossom", aura: "#c2436a", bg: "#fdeff3" },
      { id: "day_coral", name: "Day Coral", aura: "#d1495b", bg: "#fff1ef" },
      { id: "day_sun", name: "Day Sun", aura: "#b07a00", bg: "#fff8e6" },
      { id: "day_sand", name: "Day Sand", aura: "#a56a20", bg: "#f7f1e4" },
      { id: "day_slate", name: "Day Slate", aura: "#3b4c63", bg: "#eef1f5" },
      { id: "paper", name: "Paper", aura: "#3f4a57", bg: "#ffffff" },
    ],
  },
];

/** What can sit at the head of the pill. */
const INDICATORS: { id: OverlayIndicator; name: string; hint: string; icon: IconName }[] = [
  {
    id: "icon",
    name: "The line's icon",
    hint: "A mic, a note, a bulb - what this line is about to make",
    icon: "mic",
  },
  { id: "dot", name: "Red dot", hint: "The classic recording bead", icon: "bolt" },
  { id: "none", name: "Nothing", hint: "Wave and timer only", icon: "close" },
];

const THEMES: { id: Theme; name: string; hint: string; icon: IconName }[] = [
  { id: "system", name: "Match Windows", hint: "Follows the system light/dark setting", icon: "monitor" },
  { id: "light", name: "Light", hint: "Always the light palette", icon: "sun" },
  { id: "dark", name: "Dark", hint: "Always the dark palette", icon: "moon" },
];

/** A section's heading: what this group is, and what it decides. */
function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="section-head">
      <div className="section-title">{title}</div>
      {sub && <div className="section-sub">{sub}</div>}
    </div>
  );
}

/**
 * Model name entry, backed by the provider's own list.
 *
 * A hardcoded dropdown goes stale the moment a provider retires a name -
 * exactly what happened when Google pulled Gemini 2.5 for new accounts. So this
 * is a free-text field with a datalist of suggestions, and the suggestions can
 * be replaced by what the user's key can actually reach. Free text means a
 * brand-new model works the day it ships, without waiting on this app.
 */
function ModelField({
  stage,
  value,
  fallback,
  onChange,
  disabled,
  unsavedChanges,
}: {
  stage: "stt" | "refine";
  value: string;
  fallback: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  unsavedChanges: boolean;
}) {
  const [live, setLive] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A provider switch invalidates the list: the names belong to the old one.
  useEffect(() => {
    setLive(null);
    setError(null);
  }, [stage, fallback.join(",")]);

  const listId = `models-${stage}`;
  const options = live ?? fallback;

  return (
    <div className="grow">
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          list={listId}
          value={value}
          disabled={disabled}
          placeholder="model name"
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          className="btn"
          style={{ flex: "none" }}
          disabled={busy || disabled || unsavedChanges}
          title={
            unsavedChanges
              ? "Save your changes first - this reads the saved key and endpoint"
              : "Ask the provider which models this key can use"
          }
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setLive(await api.listModels(stage));
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="search" size={15} />
          {busy ? "Loading…" : "Load list"}
        </button>
      </div>

      <datalist id={listId}>
        {options.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {live && (
        <div className="field-hint">
          {live.length} models available to this key. Click the field to pick one.
        </div>
      )}
      {error && (
        <div className="diag bad" style={{ marginTop: 8, marginBottom: 0 }}>
          <div className="diag-detail">{error}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The result of one real round trip. Answers "is it the URL, the key, or the
 * model?" - the question the app previously left the user guessing at.
 */
function Diagnostic({ result }: { result: TestResult }) {
  return (
    <div className={`diag ${result.ok ? "ok" : "bad"}`}>
      <div className="diag-title">
        <Icon name={result.ok ? "check" : "alert"} size={15} />
        {result.ok ? "Working" : "Not working"}
      </div>
      <div className="diag-detail">{result.message}</div>
    </div>
  );
}

function TestButton({
  stage,
  hint,
  disabled,
  unsavedChanges,
}: {
  stage: "stt" | "refine";
  hint: string;
  disabled?: boolean;
  unsavedChanges: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  // The test reads what is persisted, not what is on screen, so testing over
  // unsaved edits would report on the old configuration and be worse than no
  // answer at all.
  return (
    <div className="section-foot">
      {result && <Diagnostic result={result} />}
      <div className="row">
        <button
          className="btn"
          disabled={busy || disabled || unsavedChanges}
          title={unsavedChanges ? "Save your changes first" : undefined}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              setResult(await api.testProvider(stage));
            } catch (e) {
              setResult({ ok: false, message: String(e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="bolt" size={15} />
          {busy ? "Testing…" : "Test this stage"}
        </button>
        <span className="hint dim" style={{ flex: 1, minWidth: 200 }}>
          {unsavedChanges ? "Save your changes first - the test runs on what is stored." : hint}
        </span>
      </div>
    </div>
  );
}

/**
 * A hotkey field that records the keypress instead of asking for its name.
 *
 * Typing the name was unworkable: the parser splits on `+` before anything
 * else, so the plus key can only be written "NumpadAdd" - unguessable, and a
 * wrong guess silently unbound everything. Pressing the key cannot be spelled
 * wrong, and the spec is checked against the real parser before it is accepted,
 * so a key this app cannot bind is refused here rather than at the moment it is
 * needed.
 */
function HotkeyField({
  value,
  status,
  onChange,
}: {
  value: string;
  status?: HotkeyState;
  onChange: (spec: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [rejected, setRejected] = useState("");

  return (
    <div className="hotkey-field">
      <button
        className={`hotkey-capture${capturing ? " capturing" : ""}`}
        onClick={() => {
          setRejected("");
          setCapturing(true);
        }}
        onBlur={() => setCapturing(false)}
        onKeyDown={(e) => {
          if (!capturing) return;
          // Every key belongs to the binding while capturing, including Tab and
          // Enter, which would otherwise leave the field instead.
          e.preventDefault();
          e.stopPropagation();

          const spec = specFromEvent(e);
          if (!spec) return; // still holding modifiers down

          if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
            setCapturing(false);
            return;
          }

          void api
            .checkHotkey(spec)
            .then(() => {
              onChange(spec);
              setRejected("");
              setCapturing(false);
            })
            .catch((err) => setRejected(String(err)));
        }}
      >
        {capturing ? "Press a key…" : <Kbd spec={value} />}
      </button>

      <div className="hotkey-note">
        {capturing ? (
          <span>Press the combination you want · Esc to cancel</span>
        ) : rejected ? (
          <span className="hotkey-bad">{rejected}</span>
        ) : status?.reset_from ? (
          <span className="hotkey-bad">
            Your saved key “{status.reset_from}” could not be bound, so this was reset.
          </span>
        ) : status && !status.bound ? (
          <span className="hotkey-bad">{status.error || "Not bound."}</span>
        ) : (
          <span>Click, then press the keys · works in every app</span>
        )}
      </div>
    </div>
  );
}

export default function SettingsView({ settings, keys, onSave, onPreviewTheme }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [mics, setMics] = useState<string[]>(["Default"]);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  /** Saved keys the user asked to forget. Applied on save, like everything
   *  else on this page, so one Discard undoes the whole visit. */
  const [clearKeys, setClearKeys] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeySlot[] | null>(null);
  // One group on screen at a time. All sections at once was a wall of fields
  // where the two that matter - which provider, which key - were
  // indistinguishable from the twenty that rarely change.
  const [section, setSection] = useState<SectionId>("lines");
  /** Which line is expanded, and which one is asking to be deleted. */
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  // The theme is the one setting whose effect *is* its preview, so the draft
  // is handed up and painted straight away; leaving the page, saving, or
  // discarding hands the window back to what is actually stored.
  useEffect(() => {
    onPreviewTheme(draft.theme === settings.theme ? null : draft.theme);
    return () => onPreviewTheme(null);
  }, [draft.theme, settings.theme, onPreviewTheme]);
  useEffect(() => {
    void api.listMicrophones().then(setMics);
    void api.hotkeyStatus().then(setHotkeys);
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const setProfile = (i: number, patch: Partial<Profile>) =>
    setDraft((d) => ({
      ...d,
      profiles: d.profiles.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));

  const moveProfile = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const next = [...d.profiles];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...d, profiles: next };
    });

  const sttMeta = STT_PROVIDERS.find((p) => p.id === draft.sttProvider)!;
  const refineMeta = REFINE_PROVIDERS.find((p) => p.id === draft.refineProvider)!;
  const sttSlot = STT_KEY_SLOT[draft.sttProvider];
  const refineSlot = REFINE_KEY_SLOT[draft.refineProvider];

  /** Only the slots the current provider choice actually reads - plus any slot
   *  a line's own override points at. */
  const requiredSlots = new Set([sttSlot, ...(draft.refineEnabled ? [refineSlot] : [])]);
  for (const p of draft.profiles) {
    if (p.stt_override) requiredSlots.add(STT_KEY_SLOT[p.stt_provider]);
    if (!p.refine_skip && p.refine_override && draft.refineEnabled)
      requiredSlots.add(REFINE_KEY_SLOT[p.refine_provider]);
  }

  /** What is saved right now, with this visit's removals taken off. */
  const keyPresent = (slot: string) =>
    (keys[slot] && !clearKeys.includes(slot)) || Boolean(keyInputs[slot]?.trim());

  /** Testing reads persisted settings, so on-screen edits must land first. */
  const unsaved =
    JSON.stringify(draft) !== JSON.stringify(settings) ||
    Object.values(keyInputs).some((v) => v.trim()) ||
    clearKeys.length > 0;

  /** Which sections want attention, for the dot in the section list. */
  const missingKey = [...requiredSlots].some((s) => !keyPresent(s));
  const unboundLine = (hotkeys ?? []).some((s) => !s.state.bound || s.state.reset_from);
  const warnings: Partial<Record<SectionId, boolean>> = {
    keys: missingKey,
    lines: unboundLine,
  };

  /** Catches the blanks here rather than as a 404 from the endpoint later, and
   *  says which section to look in. */
  function validate(): { section: SectionId; message: string } | null {
    if (!draft.sttModel.trim())
      return { section: "stt", message: "Transcription needs a model name." };
    if (sttMeta.custom && !draft.sttBaseUrl.trim())
      return { section: "stt", message: "Transcription needs an endpoint base URL." };
    if (draft.refineEnabled) {
      if (!draft.refineModel.trim())
        return { section: "refine", message: "Refinement needs a model name." };
      if (refineMeta.custom && !draft.refineBaseUrl.trim())
        return { section: "refine", message: "Refinement needs an endpoint base URL." };
    }
    for (const [i, p] of draft.profiles.entries()) {
      if (!p.name.trim())
        return { section: "lines", message: `Line ${i + 1} needs a name.` };
      if (p.stt_override && !p.stt_model.trim())
        return {
          section: "lines",
          message: `Line "${p.name}" overrides transcription but names no model.`,
        };
      if (p.refine_override && !p.refine_model.trim())
        return {
          section: "lines",
          message: `Line "${p.name}" overrides refinement but names no model.`,
        };
    }
    return null;
  }

  async function save() {
    const bad = validate();
    if (bad) {
      setProblem(bad.message);
      setSection(bad.section);
      return;
    }
    setProblem(null);

    // Keys are written to the credential store separately - they never enter
    // the settings file.
    for (const slot of clearKeys) await api.setApiKey(slot, "");
    for (const [slot, value] of Object.entries(keyInputs)) {
      if (value.trim()) await api.setApiKey(slot, value.trim());
    }
    setKeyInputs({});
    setClearKeys([]);

    // A rejected save used to vanish: the promise threw, the "Saved" flash
    // never ran, and nothing said why. The backend refuses an unbindable
    // hotkey, so that rejection is the one most worth showing.
    try {
      await onSave(draft);
    } catch (e) {
      setProblem(String(e));
      return;
    }

    setHotkeys(await api.hotkeyStatus());
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  function discard() {
    setDraft(settings);
    setKeyInputs({});
    setClearKeys([]);
    setProblem(null);
  }

  // Ctrl+S saves, the way every editor on this machine does. Settings are a
  // draft until saved, so the shortcut that means "commit it" should work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (unsaved) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <PageHead
        eyebrow="Configuration"
        title="Settings"
        lede="Changes are a draft until you save them. API keys never touch the settings file - they go to the Windows Credential Manager."
      />

      <div className="settings-layout">
        <div className="settings-nav">
          {SECTIONS.map((g) => (
            <div key={g.group}>
              <div className="label">{g.group}</div>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  className={`snav${section === s.id ? " on" : ""}`}
                  onClick={() => setSection(s.id)}
                >
                  <Icon name={s.icon} size={16} />
                  {s.name}
                  {warnings[s.id] && <span className="warn-dot" title="Needs attention" />}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div>
          {/* ------------------------------------------------------ lines */}
          {section === "lines" && (
            <div className="section">
              <SectionHead
                title="Lines"
                sub="One hotkey, one button, one way of processing what you say. A line decides how the speech is handled and where the finished text goes; anything it leaves alone falls through to the shared settings."
              />

              <div style={{ padding: "12px 0 6px" }}>
                {draft.profiles.map((p, i) => {
                  const slot = hotkeys?.find((s) => s.profile_id === p.id);
                  const open = openLine === p.id;
                  const bad = slot && (!slot.state.bound || slot.state.reset_from);
                  return (
                    <div className={`line-card${open ? " open" : ""}`} key={p.id}>
                      <div className="line-card-head">
                        <div className="line-card-grip">
                          <button
                            title="Move up"
                            disabled={i === 0}
                            onClick={() => moveProfile(i, -1)}
                          >
                            <Icon name="up" size={13} />
                          </button>
                          <button
                            title="Move down"
                            disabled={i === draft.profiles.length - 1}
                            onClick={() => moveProfile(i, 1)}
                          >
                            <Icon name="down" size={13} />
                          </button>
                        </div>

                        <button
                          className="line-card-open"
                          onClick={() => setOpenLine(open ? null : p.id)}
                        >
                          <Icon
                            name={lineIcon(p)}
                            size={16}
                            className="line-card-icon"
                          />
                          <span className="line-card-title">
                            {p.name || `Line ${i + 1}`}
                          </span>
                          <span className="line-card-chips">
                            <Kbd spec={p.hotkey} />
                            <span className="chip">
                              {p.custom_prompt.trim()
                                ? "custom instructions"
                                : MODE_LABELS[p.mode].name}
                            </span>
                            <span className="chip">
                              {OUTPUTS.find((o) => o.id === p.output)?.name}
                            </span>
                            {p.refine_skip && <span className="chip">raw</span>}
                            {(p.stt_override || p.refine_override) && (
                              <span className="chip">own model</span>
                            )}
                            {bad && <span className="chip bad">not bound</span>}
                          </span>
                          <Icon name="chevron" size={16} className="chev" />
                        </button>

                        {draft.profiles.length > 1 &&
                          (confirmDelete === p.id ? (
                            <span className="row" style={{ flexWrap: "nowrap" }}>
                              <button
                                className="btn danger sm"
                                onClick={() => {
                                  set(
                                    "profiles",
                                    draft.profiles.filter((_, j) => j !== i),
                                  );
                                  setConfirmDelete(null);
                                }}
                              >
                                Remove
                              </button>
                              <button
                                className="btn ghost sm"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              className="icon-btn danger"
                              title="Remove this line"
                              onClick={() => setConfirmDelete(p.id)}
                            >
                              <Icon name="trash" />
                            </button>
                          ))}
                      </div>

                      {open && (
                        <div className="line-card-body">
                          <div className="pair">
                            <div>
                              <div className="field-name">Name</div>
                              <div className="field-hint">
                                What the button and the recording pill call it.
                              </div>
                              <input
                                style={{ width: "100%", marginTop: 6 }}
                                value={p.name}
                                onChange={(e) => setProfile(i, { name: e.target.value })}
                              />
                            </div>
                            <div>
                              <div className="field-name">Hotkey</div>
                              <div className="field-hint">
                                Press it anywhere to start, again to finish.
                              </div>
                              <div style={{ marginTop: 6 }}>
                                <HotkeyField
                                  value={p.hotkey}
                                  status={slot?.state}
                                  onChange={(spec) => setProfile(i, { hotkey: spec })}
                                />
                              </div>
                            </div>
                          </div>

                          <div className="stack-field">
                            <div className="field-name">
                              Processing
                              <span className="chip">
                                <Icon name={lineIcon(p)} size={13} />
                                {KIND_NAME[lineKind(p)]}
                              </span>
                            </div>
                            <div className="field-hint">
                              How the transcript is turned into the finished text - and
                              which icon this line shows on the recording pill.
                            </div>
                            <select
                              disabled={Boolean(p.custom_prompt.trim())}
                              value={p.mode}
                              onChange={(e) =>
                                setProfile(i, { mode: e.target.value as Profile["mode"] })
                              }
                            >
                              {(Object.keys(MODE_LABELS) as (keyof typeof MODE_LABELS)[]).map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {MODE_LABELS[m].name} — {MODE_LABELS[m].hint}
                                  </option>
                                ),
                              )}
                            </select>
                            {p.custom_prompt.trim() && (
                              <div className="field-hint">
                                Your own instructions are set below, so the mode is not used.
                              </div>
                            )}
                          </div>

                          <div className="stack-field">
                            <div className="field-name">Destination</div>
                            <div className="choices">
                              {OUTPUTS.map((o) => (
                                <button
                                  key={o.id}
                                  className={`choice${p.output === o.id ? " on" : ""}`}
                                  onClick={() => setProfile(i, { output: o.id })}
                                >
                                  <span className="choice-name">
                                    {o.name}
                                    {p.output === o.id && <Icon name="check" size={14} />}
                                  </span>
                                  <span className="choice-hint">{o.hint}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="stack-field">
                            <div className="field-name">Custom instructions</div>
                            <div className="field-hint">
                              Filled in, these replace the processing mode entirely - your own
                              filter, your own format. Left empty, the mode above decides.
                            </div>
                            <textarea
                              rows={3}
                              dir="auto"
                              value={p.custom_prompt}
                              placeholder="e.g. Turn anything I say into a short polite email reply"
                              onChange={(e) =>
                                setProfile(i, { custom_prompt: e.target.value })
                              }
                            />
                          </div>

                          <Field
                            name="Skip refinement"
                            hint="Paste the raw transcript and skip the second API call, however this line is otherwise set up."
                          >
                            <Toggle
                              on={p.refine_skip}
                              onClick={() => setProfile(i, { refine_skip: !p.refine_skip })}
                            />
                          </Field>

                          <Field
                            name="Own transcription model"
                            hint="Off: this line uses the shared Transcription settings."
                          >
                            <Toggle
                              on={p.stt_override}
                              onClick={() => setProfile(i, { stt_override: !p.stt_override })}
                            />
                          </Field>
                          {p.stt_override && (
                            <div className="subgroup">
                              <Field name="Provider">
                                <select
                                  value={p.stt_provider}
                                  onChange={(e) => {
                                    const id = e.target.value as SttProvider;
                                    const meta = STT_PROVIDERS.find((x) => x.id === id)!;
                                    setProfile(i, {
                                      stt_provider: id,
                                      stt_model: meta.models[0] ?? "",
                                    });
                                  }}
                                >
                                  {STT_PROVIDERS.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field name="Model">
                                <input
                                  value={p.stt_model}
                                  placeholder="model name"
                                  onChange={(e) =>
                                    setProfile(i, { stt_model: e.target.value })
                                  }
                                />
                              </Field>
                            </div>
                          )}

                          <Field
                            name="Own refinement model"
                            hint="Off: this line uses the shared Refinement settings."
                          >
                            <Toggle
                              on={p.refine_override}
                              disabled={p.refine_skip}
                              onClick={() =>
                                setProfile(i, { refine_override: !p.refine_override })
                              }
                            />
                          </Field>
                          {p.refine_override && !p.refine_skip && (
                            <div className="subgroup">
                              <Field name="Provider">
                                <select
                                  value={p.refine_provider}
                                  onChange={(e) => {
                                    const id = e.target.value as RefineProvider;
                                    const meta = REFINE_PROVIDERS.find((x) => x.id === id)!;
                                    setProfile(i, {
                                      refine_provider: id,
                                      refine_model: meta.models[0] ?? "",
                                    });
                                  }}
                                >
                                  {REFINE_PROVIDERS.map((x) => (
                                    <option key={x.id} value={x.id}>
                                      {x.name}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field name="Model">
                                <input
                                  value={p.refine_model}
                                  placeholder="model name"
                                  onChange={(e) =>
                                    setProfile(i, { refine_model: e.target.value })
                                  }
                                />
                              </Field>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="section-foot">
                <button
                  className="btn"
                  onClick={() => {
                    const p = newProfile(draft.profiles.length);
                    set("profiles", [...draft.profiles, p]);
                    setOpenLine(p.id);
                  }}
                >
                  <Icon name="plus" size={15} />
                  Add a line
                </button>
                <span className="hint dim">
                  {draft.profiles.length} lines · they appear on the Home page in this order
                </span>
              </div>
            </div>
          )}

          {/* -------------------------------------------------- stage one */}
          {section === "stt" && (
            <div className="section">
              <SectionHead
                title="Transcription"
                sub="Stage 1: your voice to a raw transcript. Every line uses this unless it carries its own model."
              />

              <Field name="Provider" hint={sttMeta.hint}>
                <select
                  value={draft.sttProvider}
                  onChange={(e) => {
                    const id = e.target.value as SttProvider;
                    const meta = STT_PROVIDERS.find((p) => p.id === id)!;
                    // A model name is only meaningful to the provider it came
                    // from - "gemini-2.5-flash" would just 404 on ElevenLabs.
                    // Switch to the new provider's first model, or clear it for
                    // a custom endpoint so the field demands a real answer.
                    setDraft((d) => ({ ...d, sttProvider: id, sttModel: meta.models[0] ?? "" }));
                  }}
                >
                  {STT_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>

              {sttMeta.custom && (
                <Field
                  name="Endpoint base URL"
                  hint={
                    <>
                      Include the version segment, no trailing slash. Sends to{" "}
                      <code>/audio/transcriptions</code>.
                    </>
                  }
                >
                  <input
                    value={draft.sttBaseUrl}
                    placeholder="https://api.groq.com/openai/v1"
                    onChange={(e) => set("sttBaseUrl", e.target.value)}
                  />
                </Field>
              )}

              <Field
                name="Model"
                wide
                hint="Type it, or load the list to see exactly what this key can reach. Providers retire model names without warning, so the loaded list is the only reliable answer."
              >
                <ModelField
                  stage="stt"
                  value={draft.sttModel}
                  fallback={sttMeta.models}
                  unsavedChanges={unsaved}
                  onChange={(v) => set("sttModel", v)}
                />
              </Field>

              <Field
                name="Backup provider"
                hint="If the main provider fails, this one retries the same audio with its own key. When both fail, the recording is parked on the Home page for a manual retry."
              >
                <Toggle
                  on={draft.sttBackupEnabled}
                  onClick={() => set("sttBackupEnabled", !draft.sttBackupEnabled)}
                />
              </Field>

              {draft.sttBackupEnabled && (
                <div className="subgroup">
                  <Field name="Backup provider">
                    <select
                      value={draft.sttBackupProvider}
                      onChange={(e) => {
                        const id = e.target.value as SttProvider;
                        const meta = STT_PROVIDERS.find((p) => p.id === id)!;
                        setDraft((d) => ({
                          ...d,
                          sttBackupProvider: id,
                          sttBackupModel: meta.models[0] ?? "",
                        }));
                      }}
                    >
                      {STT_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field name="Backup model">
                    <input
                      value={draft.sttBackupModel}
                      placeholder="model name"
                      onChange={(e) => set("sttBackupModel", e.target.value)}
                    />
                  </Field>
                </div>
              )}

              <TestButton
                stage="stt"
                unsavedChanges={unsaved}
                hint="Sends 0.3 seconds of silence through the real code path — same URL, key, and model as a dictation — and reports exactly what came back."
              />
            </div>
          )}

          {/* -------------------------------------------------- stage two */}
          {section === "refine" && (
            <div className="section">
              <SectionHead
                title="Refinement"
                sub="Stage 2: the raw transcript to the finished text - cleaned up, summarised, or turned into a spec, depending on the line."
              />

              <Field
                name="Second stage"
                hint="Transcript only is faster and skips the second API call entirely."
              >
                <div className="segmented">
                  <button
                    className={!draft.refineEnabled ? "on" : ""}
                    onClick={() => set("refineEnabled", false)}
                  >
                    Transcript only
                  </button>
                  <button
                    className={draft.refineEnabled ? "on" : ""}
                    onClick={() => set("refineEnabled", true)}
                  >
                    Refine it
                  </button>
                </div>
              </Field>

              {draft.refineEnabled && (
                <>
                  <Field name="Provider" hint={refineMeta.hint}>
                    <select
                      value={draft.refineProvider}
                      onChange={(e) => {
                        const id = e.target.value as RefineProvider;
                        const meta = REFINE_PROVIDERS.find((p) => p.id === id)!;
                        setDraft((d) => ({
                          ...d,
                          refineProvider: id,
                          refineModel: meta.models[0] ?? "",
                        }));
                      }}
                    >
                      {REFINE_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {draft.refineProvider === "anthropic" && (
                    <Field
                      name="Anthropic-compatible base URL"
                      wide
                      hint={
                        <>
                          Leave empty for the official api.anthropic.com. Sends to{" "}
                          <code>/v1/messages</code>. Known bases:{" "}
                          {ANTHROPIC_BASE_EXAMPLES.map((x, i) => (
                            <span key={x.url}>
                              {i > 0 && " · "}
                              <button
                                className="link"
                                onClick={() => set("refineAnthropicBaseUrl", x.url)}
                                title={x.url}
                              >
                                {x.name}
                              </button>
                            </span>
                          ))}
                        </>
                      }
                    >
                      <input
                        value={draft.refineAnthropicBaseUrl}
                        placeholder="empty = https://api.anthropic.com"
                        onChange={(e) => set("refineAnthropicBaseUrl", e.target.value)}
                      />
                    </Field>
                  )}

                  {refineMeta.custom && (
                    <Field
                      name="Endpoint base URL"
                      wide
                      hint={
                        <>
                          Sends to <code>/chat/completions</code>. Known bases:{" "}
                          {ENDPOINT_EXAMPLES.map((x, i) => (
                            <span key={x.url}>
                              {i > 0 && " · "}
                              <button
                                className="link"
                                onClick={() => set("refineBaseUrl", x.url)}
                                title={x.url}
                              >
                                {x.name}
                              </button>
                            </span>
                          ))}
                        </>
                      }
                    >
                      <input
                        value={draft.refineBaseUrl}
                        placeholder="https://open.bigmodel.cn/api/paas/v4"
                        onChange={(e) => set("refineBaseUrl", e.target.value)}
                      />
                    </Field>
                  )}

                  <Field
                    name="Model"
                    wide
                    hint="Type it, or load the list from the provider. Nothing here validates the name against a fixed list, so a model released today works today."
                  >
                    <ModelField
                      stage="refine"
                      value={draft.refineModel}
                      fallback={refineMeta.models}
                      unsavedChanges={unsaved}
                      onChange={(v) => set("refineModel", v)}
                    />
                  </Field>
                </>
              )}

              <Field
                name="Backup provider"
                hint="If the main provider fails, this one retries the same text with its own key. When both fail, the job is parked on the Home page for a manual retry."
              >
                <Toggle
                  on={draft.refineBackupEnabled}
                  onClick={() => set("refineBackupEnabled", !draft.refineBackupEnabled)}
                />
              </Field>

              {draft.refineBackupEnabled && (
                <div className="subgroup">
                  <Field name="Backup provider">
                    <select
                      value={draft.refineBackupProvider}
                      onChange={(e) => {
                        const id = e.target.value as RefineProvider;
                        const meta = REFINE_PROVIDERS.find((p) => p.id === id)!;
                        setDraft((d) => ({
                          ...d,
                          refineBackupProvider: id,
                          refineBackupModel: meta.models[0] ?? "",
                        }));
                      }}
                    >
                      {REFINE_PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field name="Backup model">
                    <input
                      value={draft.refineBackupModel}
                      placeholder="model name"
                      onChange={(e) => set("refineBackupModel", e.target.value)}
                    />
                  </Field>
                </div>
              )}

              <TestButton
                stage="refine"
                disabled={!draft.refineEnabled}
                unsavedChanges={unsaved}
                hint="Sends a one-word prompt through the real code path and reports exactly what came back."
              />
            </div>
          )}

          {/* --------------------------------------------------------- keys */}
          {section === "keys" && (
            <>
              <div className="section">
                <SectionHead
                  title="Keys your setup needs"
                  sub="Stored in the Windows Credential Manager, never in the settings file and never in this app's folder."
                />
                {KEY_FIELDS.filter((f) => requiredSlots.has(f.slot)).map((f) => (
                  <KeyField
                    key={f.slot}
                    field={f}
                    present={keyPresent(f.slot)}
                    saved={Boolean(keys[f.slot])}
                    cleared={clearKeys.includes(f.slot)}
                    required
                    value={keyInputs[f.slot] ?? ""}
                    onChange={(v) => setKeyInputs((k) => ({ ...k, [f.slot]: v }))}
                    onClear={() => setClearKeys((c) => [...c, f.slot])}
                    onRestore={() => setClearKeys((c) => c.filter((x) => x !== f.slot))}
                  />
                ))}
              </div>

              <div className="section">
                <SectionHead
                  title="Not used right now"
                  sub="Nothing in your current configuration reads these. A key left here stays saved and costs nothing."
                />
                {KEY_FIELDS.filter((f) => !requiredSlots.has(f.slot)).map((f) => (
                  <KeyField
                    key={f.slot}
                    field={f}
                    present={keyPresent(f.slot)}
                    saved={Boolean(keys[f.slot])}
                    cleared={clearKeys.includes(f.slot)}
                    value={keyInputs[f.slot] ?? ""}
                    onChange={(v) => setKeyInputs((k) => ({ ...k, [f.slot]: v }))}
                    onClear={() => setClearKeys((c) => [...c, f.slot])}
                    onRestore={() => setClearKeys((c) => c.filter((x) => x !== f.slot))}
                  />
                ))}
              </div>
            </>
          )}

          {/* ------------------------------------------------------ capture */}
          {section === "capture" && (
            <div className="section">
              <SectionHead
                title="Audio & input"
                sub="What nutq listens to, and what it keeps afterwards."
              />

              <Field
                name="Microphone"
                hint="Default follows whatever Windows is set to. Pick a device to pin it."
              >
                <select
                  value={draft.microphone}
                  onChange={(e) => set("microphone", e.target.value)}
                >
                  {mics.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </Field>

              <Field
                name="Language hint"
                wide
                hint="Passed to both stages. Naming the dialect matters far more than naming the language."
              >
                <input
                  value={draft.languageHint}
                  dir="auto"
                  onChange={(e) => set("languageHint", e.target.value)}
                />
              </Field>

              <Field
                name="Keep recordings"
                hint="Saves each recording next to its History entry so it can be played back - the only way to settle what was actually said when a transcript reads oddly. The newest 100 are kept. Off means nothing but text is ever written to disk."
              >
                <Toggle on={draft.saveAudio} onClick={() => set("saveAudio", !draft.saveAudio)} />
              </Field>

              <div className="section-foot">
                <div className="hint dim">
                  Hotkeys belong to the lines that use them - set them under{" "}
                  <button className="link" onClick={() => setSection("lines")}>
                    Lines
                  </button>
                  . Every binding works in every app.
                </div>
                <div style={{ marginTop: 10 }}>
                  {(hotkeys ?? []).map((s) => (
                    <div className="row" key={s.profile_id} style={{ padding: "4px 0" }}>
                      <span style={{ minWidth: 150, fontWeight: 600 }}>{s.name}</span>
                      <Kbd spec={s.state.spec} />
                      {s.state.reset_from ? (
                        <span className="chip bad">was reset</span>
                      ) : s.state.bound ? (
                        <span className="chip ok">active</span>
                      ) : (
                        <span className="chip bad">{s.state.error || "not bound"}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------ overlay pill */}
          {section === "overlay" && (
            <div className="section">
              <SectionHead
                title="Recording pill"
                sub="The little indicator above the taskbar while the microphone is live. The preview runs on a simulated voice and walks through your own lines, so what you see is what the real pill does."
              />

              <div style={{ padding: "16px 0 4px" }}>
                <PillPreview
                  style={draft.overlayStyle}
                  glowInner={draft.overlayGlowInner}
                  glowOuter={draft.overlayGlowOuter}
                  auraColor={draft.overlayAuraColor}
                  bg={draft.overlayBg}
                  indicator={draft.overlayIndicator}
                  showName={draft.overlayShowName}
                  kinds={draft.profiles.map((p) => lineKind(p))}
                  names={draft.profiles.map((p) => p.name)}
                />
              </div>

              <Field
                name="Head of the pill"
                wide
                hint="The icon is the point: it says a note is being taken, or an idea is being turned into a spec, without writing the line's name across the screen."
              >
                <div className="choices">
                  {INDICATORS.map((o) => (
                    <button
                      key={o.id}
                      className={`choice${draft.overlayIndicator === o.id ? " on" : ""}`}
                      onClick={() => set("overlayIndicator", o.id)}
                    >
                      <span className="choice-name">
                        <Icon name={o.icon} size={15} />
                        {o.name}
                        {draft.overlayIndicator === o.id && <Icon name="check" size={14} />}
                      </span>
                      <span className="choice-hint">{o.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                name="Write the line's name too"
                hint="Off, the icon carries it and the pill stays short. On, the name is spelled out before the timer."
              >
                <Toggle
                  on={draft.overlayShowName}
                  onClick={() => set("overlayShowName", !draft.overlayShowName)}
                />
              </Field>

              <Field name="Wave shape" hint="What runs inside the pill while you speak.">
                <select
                  value={draft.overlayStyle}
                  onChange={(e) => set("overlayStyle", e.target.value as OverlayStyle)}
                >
                  {OVERLAY_STYLES.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {o.hint}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                name="Theme"
                wide
                hint="One pick sets the glow, the wave and the background together, so the colours always match. Each swatch is the pill itself."
              >
                <div className="theme-groups">
                  {OVERLAY_THEMES.map((g) => (
                    <div key={g.group}>
                      <div className="label">{g.group}</div>
                      <div className="theme-grid">
                        {g.items.map((t) => {
                          const on = draft.overlayTheme === t.id;
                          return (
                            <button
                              key={t.id}
                              className={`theme-chip${on ? " on" : ""}`}
                              title={`${t.name} · ${t.aura} on ${t.bg}`}
                              onClick={() =>
                                setDraft((d) => ({
                                  ...d,
                                  overlayTheme: t.id,
                                  overlayAuraColor: t.aura,
                                  overlayBg: t.bg,
                                }))
                              }
                            >
                              <span
                                className="theme-swatch"
                                style={{
                                  background: t.bg,
                                  borderColor: `${t.aura}55`,
                                  boxShadow: on ? `0 0 10px ${t.aura}66` : undefined,
                                }}
                              >
                                <i style={{ background: t.aura, height: 5 }} />
                                <i style={{ background: t.aura, height: 10 }} />
                                <i style={{ background: t.aura, height: 7 }} />
                                <i style={{ background: t.aura, height: 12 }} />
                                <i style={{ background: t.aura, height: 6 }} />
                              </span>
                              {t.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Field>

              <Field
                name="Glow — inner"
                hint="Light on the pill's own edges, brightening with your voice."
              >
                <Toggle
                  on={draft.overlayGlowInner}
                  onClick={() => set("overlayGlowInner", !draft.overlayGlowInner)}
                />
              </Field>

              <Field
                name="Glow — outer"
                hint="Light cast around the pill onto the screen behind it."
              >
                <Toggle
                  on={draft.overlayGlowOuter}
                  onClick={() => set("overlayGlowOuter", !draft.overlayGlowOuter)}
                />
              </Field>
            </div>
          )}

          {/* --------------------------------------------------- appearance */}
          {section === "appearance" && (
            <div className="section">
              <SectionHead
                title="Appearance"
                sub="How this window paints itself. The recording pill has its own themes, under Recording pill."
              />

              <Field name="Theme" wide>
                <div className="choices">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`choice${draft.theme === t.id ? " on" : ""}`}
                      onClick={() => set("theme", t.id)}
                    >
                      <span className="choice-name">
                        <Icon name={t.icon} size={15} />
                        {t.name}
                        {draft.theme === t.id && <Icon name="check" size={14} />}
                      </span>
                      <span className="choice-hint">{t.hint}</span>
                    </button>
                  ))}
                </div>
              </Field>

              <div className="section-foot">
                <div className="hint dim">
                  The theme applies the moment you pick it, so you can see it before
                  saving. Discard puts it back.
                </div>
              </div>
            </div>
          )}

          {/* --------------------------------------------------- vocabulary */}
          {section === "words" && (
            <>
              <div className="section">
                <SectionHead
                  title="Corrections"
                  sub="Terms the transcriber mishears. Left is what comes out wrong, right is what you actually said."
                />
                <div style={{ padding: "14px 0" }}>
                  {draft.dictionary.map((d, i) => (
                    <div className="list-row" key={i}>
                      <input
                        placeholder="heard as"
                        dir="auto"
                        value={d.from}
                        onChange={(e) => {
                          const next = [...draft.dictionary];
                          next[i] = { ...next[i], from: e.target.value };
                          set("dictionary", next);
                        }}
                      />
                      <input
                        placeholder="should be"
                        dir="auto"
                        value={d.to}
                        onChange={(e) => {
                          const next = [...draft.dictionary];
                          next[i] = { ...next[i], to: e.target.value };
                          set("dictionary", next);
                        }}
                      />
                      <button
                        className="icon-btn danger"
                        title="Remove"
                        onClick={() =>
                          set("dictionary", draft.dictionary.filter((_, j) => j !== i))
                        }
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  ))}
                  {draft.dictionary.length === 0 && (
                    <div className="hint dim" style={{ marginBottom: 10 }}>
                      Nothing yet. Add the words this app keeps getting wrong.
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={() => set("dictionary", [...draft.dictionary, { from: "", to: "" }])}
                  >
                    <Icon name="plus" size={15} />
                    Add a correction
                  </button>
                </div>
              </div>

              <div className="section">
                <SectionHead
                  title="Snippets"
                  sub="Say the trigger out loud and it expands to the text."
                />
                <div style={{ padding: "14px 0" }}>
                  {draft.snippets.map((s, i) => (
                    <div className="list-row" key={i}>
                      <input
                        placeholder="when I say"
                        dir="auto"
                        value={s.trigger}
                        onChange={(e) => {
                          const next = [...draft.snippets];
                          next[i] = { ...next[i], trigger: e.target.value };
                          set("snippets", next);
                        }}
                      />
                      <input
                        placeholder="write this"
                        dir="auto"
                        value={s.text}
                        onChange={(e) => {
                          const next = [...draft.snippets];
                          next[i] = { ...next[i], text: e.target.value };
                          set("snippets", next);
                        }}
                      />
                      <button
                        className="icon-btn danger"
                        title="Remove"
                        onClick={() =>
                          set("snippets", draft.snippets.filter((_, j) => j !== i))
                        }
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  ))}
                  {draft.snippets.length === 0 && (
                    <div className="hint dim" style={{ marginBottom: 10 }}>
                      Nothing yet. A snippet turns one spoken word into a whole phrase.
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={() =>
                      set("snippets", [...draft.snippets, { trigger: "", text: "" }])
                    }
                  >
                    <Icon name="plus" size={15} />
                    Add a snippet
                  </button>
                </div>
              </div>
            </>
          )}

          {problem && (
            <div className="banner error">
              <Icon name="alert" size={18} className="banner-ico" />
              <div className="banner-text">{problem}</div>
              <div className="banner-actions">
                <button className="btn sm" onClick={() => setProblem(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Settings are a draft until saved, and the only honest place for
              that fact is pinned to the bottom of the page it applies to. */}
          <div className={`savebar${unsaved ? " dirty" : ""}`}>
            <div className="savebar-text">
              {unsaved ? (
                <>
                  <span className="dot busy" />
                  <b>Unsaved changes</b>
                  <span>· Ctrl+S saves</span>
                </>
              ) : saved ? (
                <>
                  <Icon name="check" size={15} />
                  <b>Saved</b>
                </>
              ) : (
                <span>Everything on this page is saved.</span>
              )}
            </div>
            <div className="spacer" />
            <button className="btn ghost" disabled={!unsaved} onClick={discard}>
              Discard
            </button>
            <button className="btn primary" disabled={!unsaved} onClick={() => void save()}>
              Save changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** One credential slot: what it is, where it comes from, and whether it is
 *  there. The value is write-only - a saved key is never read back into the
 *  page, so nothing on screen can leak it, and "forget this key" is a draft
 *  like everything else here: it happens on Save, and Discard undoes it. */
function KeyField({
  field,
  present,
  saved,
  cleared,
  required,
  value,
  onChange,
  onClear,
  onRestore,
}: {
  field: { slot: string; name: string; where: string; placeholder: string };
  present: boolean;
  saved: boolean;
  cleared: boolean;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  onRestore: () => void;
}) {
  return (
    <Field
      name={field.name}
      badge={
        cleared ? (
          <span className="chip warn">forgotten on save</span>
        ) : present ? (
          <span className="chip ok">saved</span>
        ) : required ? (
          <span className="chip warn">needed</span>
        ) : (
          <span className="chip">empty</span>
        )
      }
      hint={`From ${field.where}`}
    >
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={
          saved && !cleared ? "•••••••• (leave blank to keep)" : field.placeholder
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {saved &&
        (cleared ? (
          <button className="btn sm" title="Keep this key after all" onClick={onRestore}>
            Undo
          </button>
        ) : (
          <button className="icon-btn danger" title="Forget this key" onClick={onClear}>
            <Icon name="trash" />
          </button>
        ))}
    </Field>
  );
}
