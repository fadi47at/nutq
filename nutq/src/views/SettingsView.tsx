import { useEffect, useRef, useState } from "react";
import {
  api,
  ANTHROPIC_BASE_EXAMPLES,
  ENDPOINT_EXAMPLES,
  REFINE_KEY_SLOT,
  REFINE_PROVIDERS,
  STT_KEY_SLOT,
  STT_PROVIDERS,
  type HotkeyReport,
  type HotkeyState,
  type KeyStatus,
  type OverlayStyle,
  type RefineProvider,
  type Settings,
  type SttProvider,
  type TestResult,
} from "../lib/api";
import { prettyHotkey, specFromEvent } from "../lib/hotkeys";

interface Props {
  settings: Settings;
  keys: KeyStatus;
  onSave: (next: Settings) => Promise<void>;
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

type TabId = "stt" | "refine" | "keys" | "capture" | "words" | "overlay";

/** Ordered the way the pipeline runs, so the list reads as the flow itself. */
const TABS: { id: TabId; name: string }[] = [
  { id: "stt", name: "Transcription" },
  { id: "refine", name: "Refinement" },
  { id: "keys", name: "Keys" },
  { id: "capture", name: "Capture" },
  { id: "overlay", name: "Recording pill" },
  { id: "words", name: "Vocabulary" },
];

/** The wave shapes that can run inside the recording pill. */
const OVERLAY_STYLES: { id: OverlayStyle; name: string; hint: string }[] = [
  { id: "bars", name: "Bars", hint: "The classic dancing columns" },
  { id: "ribbon", name: "Breathing band", hint: "A soft band that swells with your voice" },
  { id: "blobs", name: "Syllables", hint: "One block per spoken syllable, gaps for pauses" },
  { id: "meter", name: "Level meter", hint: "A gradient bar with a peak-hold marker" },
  { id: "ring", name: "Pulse", hint: "Rings around the dot, no wave at all" },
];

/** Coordinated color themes for the pill. One pick sets the glow-and-wave
 *  color and the background together, so the result always matches. Light
 *  ("Day") themes keep the wave dark enough to read on a pale pill. */
const OVERLAY_THEMES: { id: string; name: string; aura: string; bg: string }[] = [
  { id: "teal_night", name: "Teal Night", aura: "#2fd6a5", bg: "#12161d" },
  { id: "pure_day", name: "Pure Day", aura: "#0f9d8f", bg: "#f3f6f8" },
  { id: "desert", name: "Desert", aura: "#e8b45a", bg: "#1d1712" },
  { id: "day_sand", name: "Day Sand", aura: "#a56a20", bg: "#f7f1e4" },
  { id: "ocean", name: "Ocean", aura: "#4aa8ff", bg: "#0e1520" },
  { id: "day_sky", name: "Day Sky", aura: "#1668c9", bg: "#eef4fc" },
  { id: "rose", name: "Rose", aura: "#ff7d9c", bg: "#1c1218" },
  { id: "day_blossom", name: "Day Blossom", aura: "#c2436a", bg: "#fdeff3" },
  { id: "violet", name: "Violet", aura: "#a78bfa", bg: "#151021" },
  { id: "emerald", name: "Emerald", aura: "#34d399", bg: "#0d1a14" },
  { id: "day_mint", name: "Day Mint", aura: "#0e8a63", bg: "#eefaf3" },
  { id: "amber", name: "Amber", aura: "#f59e0b", bg: "#1a120a" },
  { id: "crimson", name: "Crimson", aura: "#ef6b6b", bg: "#1a0f0f" },
  { id: "frost", name: "Frost", aura: "#9be8e0", bg: "#101820" },
  { id: "day_slate", name: "Day Slate", aura: "#3b4c63", bg: "#eef1f5" },
];

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [47, 214, 165];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function isLightBg(hex: string): boolean {
  const [r, g, b] = hexRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

/** A live miniature of the pill with the chosen look, driven by a simulated
 *  voice so colors and shapes can be judged without dictating. Mirrors the
 *  glow composition the real overlay uses: two independent parts. */
function PillPreview({
  style,
  glowInner,
  glowOuter,
  auraColor,
  bg,
}: {
  style: OverlayStyle;
  glowInner: boolean;
  glowOuter: boolean;
  auraColor: string;
  bg: string;
}) {
  const pill = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const fill = useRef<HTMLElement | null>(null);
  const ring = useRef<HTMLElement | null>(null);
  const wave = useRef<HTMLSpanElement | null>(null);
  const peak = useRef(0.02);
  const hist = useRef<number[]>([]);
  const phase = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      phase.current += dt;
      // A speech-like envelope: syllable bursts with pauses.
      const syl = 0.55 + 0.45 * Math.sin(phase.current * 2 * Math.PI * 3.6);
      const phrase = (Math.sin(phase.current * 0.9) + Math.sin(phase.current * 0.23)) / 2;
      const talking = phrase > -0.25;
      const level = talking ? 0.012 + 0.09 * Math.max(0, syl) * (0.8 + 0.2 * phrase) : 0.0015;
      peak.current = Math.max(level, peak.current * 0.995);
      const db = 20 * Math.log10(Math.max(level, 1e-5));
      const dbN = Math.min(1, Math.max(0.04, (db + 58) / 40));
      const agc = Math.min(1, Math.max(0.04, (level / Math.max(peak.current, 0.018)) * 0.88));
      const v = Math.min(1, Math.max(0.04, agc * 0.65 + dbN * 0.35));
      const silent = !talking;

      const el = pill.current;
      if (el) {
        const m = /^#?([0-9a-f]{6})$/i.exec(auraColor.trim());
        const n = m ? parseInt(m[1], 16) : 0x2fd6a5;
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        if (!glowInner && !glowOuter) {
          el.style.borderColor = "#2b3341";
          el.style.boxShadow = "none";
        } else {
          const outer = glowOuter
            ? `0 0 ${(5 + v * 12) * 1.3}px rgba(${r},${g},${b},${0.14 + v * 0.42}),` +
              `0 0 ${(13 + v * 30) * 1.3}px rgba(${r},${g},${b},${0.08 + v * 0.34})`
            : "";
          const inner = glowInner
            ? `${outer ? "," : ""}inset 0 0 ${(2 + v * 15) * 1.3}px rgba(${r},${g},${b},${0.07 + v * 0.26})`
            : "";
          el.style.borderColor = glowOuter
            ? `rgba(${r},${g},${b},${0.28 + v * 0.6})`
            : "#2b3341";
          el.style.boxShadow = `${outer}${inner}` || "none";
        }
      }

      const color = silent ? "#e5b062" : auraColor;
      if (wave.current) {
        wave.current.querySelectorAll<HTMLElement>("i").forEach((bar, i, all) => {
          const t = (phase.current * 0.62 + i / all.length) % 1;
          const h = talking ? Math.max(2.4, Math.abs(Math.sin(t * Math.PI * 3)) * v * 24) : 2.4;
          bar.style.height = `${h}px`;
          bar.style.background = color;
        });
      }
      const c = canvas.current;
      if (c) {
        const ctx = c.getContext("2d");
        if (ctx) {
          if (!c.width) {
            const dpr = 2;
            c.width = Math.max(1, c.clientWidth) * dpr;
            c.height = Math.max(1, c.clientHeight) * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          const w = c.clientWidth, h = c.clientHeight, mid = h / 2;
          ctx.clearRect(0, 0, w, h);
          if (style === "ribbon") {
            hist.current.push(v);
            if (hist.current.length > 62) hist.current.shift();
          } else {
            hist.current.push(talking && level > 0.01 ? Math.max(0.12, v) : 0);
            if (hist.current.length > 62) hist.current.shift();
          }
          const vals = hist.current;
          if (vals.length > 2) {
            const step = w / 62;
            const x0 = w - vals.length * step;
            if (style === "ribbon") {
              const y = (val: number) => 2 + val * (mid - 3);
              const yT = (val: number) => mid - (y(val) - mid);
              ctx.beginPath();
              ctx.moveTo(x0, yT(vals[0]));
              for (let i = 1; i < vals.length; i++) {
                const xa = x0 + (i - 1) * step, xb = x0 + i * step;
                ctx.quadraticCurveTo(xa, yT(vals[i - 1]), (xa + xb) / 2, (yT(vals[i - 1]) + yT(vals[i])) / 2);
              }
              for (let i = vals.length - 1; i >= 0; i--) {
                const xa = x0 + i * step, xb = x0 + (i + 1) * step;
                const prev = i > 0 ? vals[i - 1] : vals[i];
                ctx.quadraticCurveTo(xa, y(vals[i]), (xa + xb) / 2, (y(vals[i]) + y(prev)) / 2);
              }
              ctx.closePath();
              ctx.globalAlpha = silent ? 0.55 : 1;
              ctx.fillStyle = color;
              ctx.fill();
              ctx.globalAlpha = 1;
            } else {
              ctx.fillStyle = color;
              vals.forEach((b, i) => {
                if (b <= 0) return;
                const bh = 4 + b * (h - 8);
                ctx.globalAlpha = silent ? 0.5 : 0.35 + b * 0.65;
                ctx.beginPath();
                ctx.roundRect(x0 + i * step, mid - bh / 2, Math.max(2, step - 1), bh, 1.5);
                ctx.fill();
              });
              ctx.globalAlpha = 1;
            }
          }
        }
      }
      if (fill.current) {
        fill.current.style.width = `${v * 100}%`;
        fill.current.style.background = `linear-gradient(90deg, ${color} 0%, ${color} 62%, #e5b062 84%, #ef6b6b 97%)`;
      }
      if (ring.current) {
        const d = 10 + v * 28;
        ring.current.style.width = `${d}px`;
        ring.current.style.height = `${d}px`;
        ring.current.style.opacity = `${0.2 + v * 0.7}`;
        ring.current.style.borderColor = color;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [style, glowInner, glowOuter, auraColor, bg]);

  const resetCanvas = (el: HTMLCanvasElement | null) => {
    canvas.current = el;
    if (el) el.width = 0;
  };

  return (
    <div className="pill-preview">
      <div className="overlay-pill" ref={pill} style={{ background: bg }}>
        {style === "ring" ? (
          <span className="overlay-ringbox">
            <span className="overlay-dot" />
            <i className="overlay-ring" ref={ring} />
          </span>
        ) : (
          <span className="overlay-dot" />
        )}
        {style === "bars" && (
          <span className="overlay-wave" ref={wave}>
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        )}
        {(style === "ribbon" || style === "blobs") && <canvas className="overlay-canvas" ref={resetCanvas} />}
        {style === "meter" && (
          <span className="overlay-meter">
            <i ref={fill} />
          </span>
        )}
        <span
          className="overlay-timer"
          style={isLightBg(bg) ? { color: "#4a5563" } : undefined}
        >
          0:07
        </span>
      </div>
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button className={`switch${on ? " on" : ""}`} onClick={onClick} />;
}

/**
 * Model name entry, backed by the provider's own list.
 *
 * A hardcoded dropdown goes stale the moment a provider retires a name -
 * exactly what happened when Google pulled Gemini 2.5 for new accounts. So
 * this is a free-text field with a datalist of suggestions, and the suggestions
 * can be replaced by what the user's key can actually reach. Free text means a
 * brand-new model works the day it ships, without waiting on this app.
 */
function ModelField({
  stage,
  value,
  fallback,
  disabled,
  unsavedChanges,
  onChange,
}: {
  stage: "stt" | "refine";
  value: string;
  fallback: string[];
  disabled?: boolean;
  unsavedChanges: boolean;
  onChange: (v: string) => void;
}) {
  const [live, setLive] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggestions reset when the provider changes, or the previous provider's
  // model names would linger in the list.
  useEffect(() => {
    setLive(null);
    setError(null);
  }, [stage, fallback.join(",")]);

  const listId = `models-${stage}`;
  const options = live ?? fallback;

  return (
    <div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input
          list={listId}
          value={value}
          disabled={disabled}
          placeholder="model name"
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
          {busy ? "Loading…" : "Load available models"}
        </button>
      </div>

      <datalist id={listId}>
        {options.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      {live && (
        <div className="field-hint" style={{ marginTop: 6 }}>
          {live.length} models available to this key. Click the field to pick one.
        </div>
      )}
      {error && (
        <div className="diag bad" style={{ marginTop: 8, marginBottom: 0 }}>
          <div className="diag-detail" style={{ whiteSpace: "pre-wrap" }}>
            {error}
          </div>
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
        {result.ok ? "Working" : "Not working"}
      </div>
      <div className="diag-detail" style={{ whiteSpace: "pre-wrap" }}>
        {result.message}
      </div>
    </div>
  );
}

function TestButton({
  stage,
  disabled,
  unsavedChanges,
}: {
  stage: "stt" | "refine";
  disabled?: boolean;
  unsavedChanges: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);

  // The test reads what is persisted, not what is on screen, so testing over
  // unsaved edits would report on the old configuration and be worse than no
  // answer at all.
  if (unsavedChanges) {
    return (
      <div className="diag">
        <div className="diag-detail">Save your changes to test this stage.</div>
      </div>
    );
  }

  return (
    <>
      {result && <Diagnostic result={result} />}
      <button
        className="btn"
        disabled={busy || disabled}
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
        {busy ? "Testing…" : "Test this stage"}
      </button>
    </>
  );
}

/**
 * A hotkey field that records the keypress instead of asking for its name.
 *
 * Typing the name was unworkable: the parser splits on `+` before anything
 * else, so the plus key can only be written "NumpadAdd" - unguessable, and a
 * wrong guess silently unbound everything. Pressing the key cannot be spelled
 * wrong, and the spec is checked against the real parser before it is accepted,
 * so a key this app cannot bind is refused here rather than at the moment it
 * is needed.
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
          // Every key belongs to the binding while capturing, including Tab
          // and Enter, which would otherwise leave the field instead.
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
        {capturing ? "Press a key…" : prettyHotkey(value)}
      </button>

      <div className="hotkey-note">
        {capturing ? (
          <span>Esc to cancel</span>
        ) : rejected ? (
          <span className="hotkey-bad">{rejected}</span>
        ) : status?.reset_from ? (
          <span className="hotkey-bad">
            Your saved key “{status.reset_from}” could not be bound, so this was reset.
          </span>
        ) : status && !status.bound ? (
          <span className="hotkey-bad">{status.error || "Not bound."}</span>
        ) : (
          <span className="hotkey-raw">{value}</span>
        )}
      </div>
    </div>
  );
}

export default function SettingsView({ settings, keys, onSave }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [mics, setMics] = useState<string[]>(["Default"]);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyReport | null>(null);
  // One group on screen at a time. All seven sections at once was a wall of
  // fields where the two that matter - which provider, which key - were
  // indistinguishable from the twenty that rarely change.
  const [tab, setTab] = useState<TabId>("stt");

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    void api.listMicrophones().then(setMics);
    void api.hotkeyStatus().then(setHotkeys);
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const sttMeta = STT_PROVIDERS.find((p) => p.id === draft.sttProvider)!;
  const refineMeta = REFINE_PROVIDERS.find((p) => p.id === draft.refineProvider)!;
  const sttSlot = STT_KEY_SLOT[draft.sttProvider];
  const refineSlot = REFINE_KEY_SLOT[draft.refineProvider];

  /** Only the slots the current provider choice actually reads. */
  const requiredSlots = new Set([sttSlot, ...(draft.refineEnabled ? [refineSlot] : [])]);

  /** Testing reads persisted settings, so on-screen edits must land first. */
  const unsaved =
    JSON.stringify(draft) !== JSON.stringify(settings) ||
    Object.values(keyInputs).some((v) => v.trim());

  /** Catches the blanks here rather than as a 404 from the endpoint later. */
  function validate(): string | null {
    if (!draft.sttModel.trim()) return "Stage 1 needs a model name.";
    if (sttMeta.custom && !draft.sttBaseUrl.trim())
      return "Stage 1 needs an endpoint base URL.";
    if (draft.refineEnabled) {
      if (!draft.refineModel.trim()) return "Stage 2 needs a model name.";
      if (refineMeta.custom && !draft.refineBaseUrl.trim())
        return "Stage 2 needs an endpoint base URL.";
    }
    return null;
  }

  async function save() {
    const bad = validate();
    if (bad) {
      setProblem(bad);
      return;
    }
    setProblem(null);

    // Keys are written to the credential store separately - they never enter
    // the settings file.
    for (const [slot, value] of Object.entries(keyInputs)) {
      if (value.trim()) await api.setApiKey(slot, value.trim());
    }
    setKeyInputs({});

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

  return (
    <>
      <div className="eyebrow">Configuration</div>
      <h1>Settings</h1>
      <p className="lede">API keys are stored in the Windows Credential Manager.</p>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* ---------------------------------------------------------- stage 1 */}
      {tab === "stt" && (
      <div className="section">
        <div className="section-title">Stage 1 · Speech to raw transcript</div>

        <div className="field">
          <div>
            <div className="field-name">Provider</div>
            <div className="field-hint">{sttMeta.hint}</div>
          </div>
          <select
            value={draft.sttProvider}
            onChange={(e) => {
              const id = e.target.value as SttProvider;
              const meta = STT_PROVIDERS.find((p) => p.id === id)!;
              // A model name is only meaningful to the provider it came from -
              // "gemini-2.5-flash" would just 404 on ElevenLabs. Switch to the
              // new provider's first model, or clear it for a custom endpoint
              // so the field shows its placeholder and demands a real answer.
              setDraft((d) => ({
                ...d,
                sttProvider: id,
                sttModel: meta.models[0] ?? "",
              }));
            }}
          >
            {STT_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {sttMeta.custom && (
          <div className="field">
            <div>
              <div className="field-name">Endpoint base URL</div>
              <div className="field-hint">
                Include the version segment, no trailing slash. Sends to{" "}
                <code>/audio/transcriptions</code>.
              </div>
            </div>
            <input
              value={draft.sttBaseUrl}
              placeholder="https://api.groq.com/openai/v1"
              onChange={(e) => set("sttBaseUrl", e.target.value)}
            />
          </div>
        )}

        <div className="field">
          <div>
            <div className="field-name">Model</div>
            <div className="field-hint">
              Type it, or load the list to see exactly what this key can reach. Providers
              retire model names without warning, so the loaded list is the only reliable
              answer.
            </div>
          </div>
          <ModelField
            stage="stt"
            value={draft.sttModel}
            fallback={sttMeta.models}
            unsavedChanges={unsaved}
            onChange={(v) => set("sttModel", v)}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Backup provider</div>
            <div className="field-hint">
              If the main provider fails, this one retries the same audio. Uses its own key
              from the Keys list below. When both fail, the recording is saved to Pending for
              a manual retry.
            </div>
          </div>
          <Toggle
            on={draft.sttBackupEnabled}
            onClick={() => set("sttBackupEnabled", !draft.sttBackupEnabled)}
          />
        </div>

        {draft.sttBackupEnabled && (
          <>
            <div className="field">
              <div>
                <div className="field-name">Backup: provider</div>
              </div>
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
            </div>
            <div className="field">
              <div>
                <div className="field-name">Backup: model</div>
              </div>
              <input
                value={draft.sttBackupModel}
                placeholder="model name"
                onChange={(e) => set("sttBackupModel", e.target.value)}
              />
            </div>
          </>
        )}

        <div style={{ padding: "10px 0 14px" }}>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Sends 0.3 seconds of silence through the real code path — same URL, key, and model
            as a dictation — and reports exactly what came back.
          </div>
          <TestButton stage="stt" unsavedChanges={unsaved} />
        </div>
      </div>
      )}

      {/* ---------------------------------------------------------- stage 2 */}
      {tab === "refine" && (
      <div className="section">
        <div className="section-title">
          Stage 2 · Transcript to finished text (cleanup, summary, proofread)
        </div>

        <div className="field">
          <div>
            <div className="field-name">Output</div>
            <div className="field-hint">
              Transcript only is faster and skips the second API call. With refinement the
              transcript is cleaned up, summarised, or structured first.
            </div>
          </div>
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
              Transcript + refinement
            </button>
          </div>
        </div>

        {draft.refineEnabled && (
          <>
            <div className="field">
              <div>
                <div className="field-name">Provider</div>
                <div className="field-hint">{refineMeta.hint}</div>
              </div>
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
            </div>

            {draft.refineProvider === "anthropic" && (
              <div className="field">
                <div>
                  <div className="field-name">Anthropic-compatible base URL</div>
                  <div className="field-hint">
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
                  </div>
                </div>
                <input
                  value={draft.refineAnthropicBaseUrl}
                  placeholder="empty = https://api.anthropic.com"
                  onChange={(e) => set("refineAnthropicBaseUrl", e.target.value)}
                />
              </div>
            )}

            {refineMeta.custom && (
              <div className="field">
                <div>
                  <div className="field-name">Endpoint base URL</div>
                  <div className="field-hint">
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
                  </div>
                </div>
                <input
                  value={draft.refineBaseUrl}
                  placeholder="https://open.bigmodel.cn/api/paas/v4"
                  onChange={(e) => set("refineBaseUrl", e.target.value)}
                />
              </div>
            )}

            <div className="field">
              <div>
                <div className="field-name">Model</div>
                <div className="field-hint">
                  Type it, or load the list from the provider. Nothing here validates the name
                  against a fixed list, so a model released today works today.
                </div>
              </div>
              <ModelField
                stage="refine"
                value={draft.refineModel}
                fallback={refineMeta.models}
                unsavedChanges={unsaved}
                onChange={(v) => set("refineModel", v)}
              />
            </div>
          </>
        )}

        <div className="field">
          <div>
            <div className="field-name">Backup provider</div>
            <div className="field-hint">
              If the main provider fails, this one retries the same text. Uses its own key from
              the Keys list below. When both fail, the job is saved to Pending for a manual
              retry.
            </div>
          </div>
          <Toggle
            on={draft.refineBackupEnabled}
            onClick={() => set("refineBackupEnabled", !draft.refineBackupEnabled)}
          />
        </div>

        {draft.refineBackupEnabled && (
          <>
            <div className="field">
              <div>
                <div className="field-name">Backup: provider</div>
              </div>
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
            </div>
            <div className="field">
              <div>
                <div className="field-name">Backup: model</div>
              </div>
              <input
                value={draft.refineBackupModel}
                placeholder="model name"
                onChange={(e) => set("refineBackupModel", e.target.value)}
              />
            </div>
          </>
        )}

        <div style={{ padding: "10px 0 14px" }}>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Sends a one-word prompt through the real code path and reports exactly what came
            back.
          </div>
          <TestButton stage="refine" disabled={!draft.refineEnabled} unsavedChanges={unsaved} />
        </div>
      </div>
      )}

      {/* ------------------------------------------------------------- keys */}
      {tab === "keys" && (
      <div className="section">
        <div className="section-title">Keys</div>
        {KEY_FIELDS.map((f) => {
          const needed = requiredSlots.has(f.slot);
          return (
            <div className="field" key={f.slot} style={needed ? undefined : { opacity: 0.5 }}>
              <div>
                <div className="field-name">
                  {f.name}{" "}
                  {needed ? (
                    keys[f.slot] ? (
                      <span className="tag-ok">· saved</span>
                    ) : (
                      <span className="tag-missing">· required, not set</span>
                    )
                  ) : keys[f.slot] ? (
                    <span className="field-hint">· saved, unused</span>
                  ) : (
                    <span className="field-hint">· not needed</span>
                  )}
                </div>
                <div className="field-hint">From {f.where}</div>
              </div>
              <input
                type="password"
                placeholder={keys[f.slot] ? "•••••••• (leave blank to keep)" : f.placeholder}
                value={keyInputs[f.slot] ?? ""}
                onChange={(e) =>
                  setKeyInputs((k) => ({ ...k, [f.slot]: e.target.value }))
                }
              />
            </div>
          );
        })}
      </div>
      )}

      {/* --------------------------------------------------------- capture */}
      {tab === "capture" && (
      <div className="section">
        <div className="section-title">Capture</div>

        <div className="field">
          <div>
            <div className="field-name">Language hint</div>
            <div className="field-hint">
              Passed to both stages. Naming the dialect matters far more than naming the
              language.
            </div>
          </div>
          <input
            value={draft.languageHint}
            onChange={(e) => set("languageHint", e.target.value)}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Microphone</div>
          </div>
          <select value={draft.microphone} onChange={(e) => set("microphone", e.target.value)}>
            {mics.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <div>
            <div className="field-name">Keep recordings</div>
            <div className="field-hint">
              Saves each recording next to its History entry so it can be played back - the
              only way to settle what was actually said when a transcript reads oddly. The
              newest 100 are kept. Off means nothing but text is ever written to disk.
            </div>
          </div>
          <Toggle on={draft.saveAudio} onClick={() => set("saveAudio", !draft.saveAudio)} />
        </div>
      </div>
      )}

      {/* ------------------------------------------------------- shortcuts */}
      {tab === "capture" && (
      <div className="section">
        <div className="section-title">Shortcuts</div>

        <div className="field">
          <div>
            <div className="field-name">Dictate hotkey</div>
            <div className="field-hint">
              Works in every app. Click the field and press the key you want - including
              keypad keys and modifier combinations.
            </div>
          </div>
          <HotkeyField
            value={draft.hotkey}
            status={hotkeys?.dictate}
            onChange={(spec) => set("hotkey", spec)}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Review hotkey</div>
            <div className="field-hint">
              Brings the result here to read and edit instead of pasting it
            </div>
          </div>
          <HotkeyField
            value={draft.draftHotkey}
            status={hotkeys?.draft}
            onChange={(spec) => set("draftHotkey", spec)}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Default destination</div>
            <div className="field-hint">What the dictate hotkey does with the finished text</div>
          </div>
          <select
            value={draft.output}
            onChange={(e) => set("output", e.target.value as Settings["output"])}
          >
            <option value="instant">Paste into the focused field</option>
            <option value="draft">Show it here for review</option>
          </select>
        </div>
      </div>
      )}

      {/* ------------------------------------------------------ overlay pill */}
      {tab === "overlay" && (
      <div className="section">
        <div className="section-title">Recording pill</div>
        <div style={{ padding: "2px 0 14px" }}>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            The little indicator above the taskbar while the microphone is live. The preview
            below runs on a simulated voice, so the real pill behaves the same.
          </div>
          <PillPreview
            style={draft.overlayStyle}
            glowInner={draft.overlayGlowInner}
            glowOuter={draft.overlayGlowOuter}
            auraColor={draft.overlayAuraColor}
            bg={draft.overlayBg}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Wave shape</div>
            <div className="field-hint">What runs inside the pill while you speak.</div>
          </div>
          <select
            value={draft.overlayStyle}
            onChange={(e) => set("overlayStyle", e.target.value as OverlayStyle)}
          >
            {OVERLAY_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.hint}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <div>
            <div className="field-name">Theme</div>
            <div className="field-hint">
              One pick sets the glow, wave, and background together, so the colors always
              match.
            </div>
          </div>
          <div className="theme-grid">
            {OVERLAY_THEMES.map((t) => {
              const on = draft.overlayTheme === t.id;
              return (
                <button
                  key={t.id}
                  className={`theme-chip${on ? " on" : ""}`}
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
                    className="theme-dot"
                    style={{ background: t.aura, boxShadow: `0 0 8px ${t.aura}` }}
                  />
                  <span
                    className="theme-bg"
                    style={{ background: t.bg, border: `1px solid ${t.aura}55` }}
                  />
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div>
            <div className="field-name">Glow — inner</div>
            <div className="field-hint">
              Light on the pill's own edges, brightening with your voice.
            </div>
          </div>
          <Toggle
            on={draft.overlayGlowInner}
            onClick={() => set("overlayGlowInner", !draft.overlayGlowInner)}
          />
        </div>

        <div className="field">
          <div>
            <div className="field-name">Glow — outer</div>
            <div className="field-hint">
              Light cast around the pill onto the screen behind it.
            </div>
          </div>
          <Toggle
            on={draft.overlayGlowOuter}
            onClick={() => set("overlayGlowOuter", !draft.overlayGlowOuter)}
          />
        </div>
      </div>
      )}

      {/* ------------------------------------------------------ vocabulary */}
      {tab === "words" && (
      <div className="section">
        <div className="section-title">Dictionary</div>
        <div style={{ padding: "6px 0 16px" }}>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Terms the transcriber mishears. Left is what comes out wrong, right is what you
            actually said.
          </div>
          {draft.dictionary.map((d, i) => (
            <div className="list-row" key={i}>
              <input
                placeholder="heard as"
                value={d.from}
                onChange={(e) => {
                  const next = [...draft.dictionary];
                  next[i] = { ...next[i], from: e.target.value };
                  set("dictionary", next);
                }}
              />
              <input
                placeholder="should be"
                value={d.to}
                onChange={(e) => {
                  const next = [...draft.dictionary];
                  next[i] = { ...next[i], to: e.target.value };
                  set("dictionary", next);
                }}
              />
              <button
                className="icon-btn"
                onClick={() =>
                  set("dictionary", draft.dictionary.filter((_, j) => j !== i))
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn ghost"
            onClick={() => set("dictionary", [...draft.dictionary, { from: "", to: "" }])}
          >
            + Add correction
          </button>
        </div>
      </div>
      )}

      {tab === "words" && (
      <div className="section">
        <div className="section-title">Snippets</div>
        <div style={{ padding: "6px 0 16px" }}>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Say the trigger out loud and it expands to the text.
          </div>
          {draft.snippets.map((s, i) => (
            <div className="list-row" key={i}>
              <input
                placeholder="when I say"
                value={s.trigger}
                onChange={(e) => {
                  const next = [...draft.snippets];
                  next[i] = { ...next[i], trigger: e.target.value };
                  set("snippets", next);
                }}
              />
              <input
                placeholder="write this"
                value={s.text}
                onChange={(e) => {
                  const next = [...draft.snippets];
                  next[i] = { ...next[i], text: e.target.value };
                  set("snippets", next);
                }}
              />
              <button
                className="icon-btn"
                onClick={() => set("snippets", draft.snippets.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn ghost"
            onClick={() => set("snippets", [...draft.snippets, { trigger: "", text: "" }])}
          >
            + Add snippet
          </button>
        </div>
      </div>
      )}

      {problem && (
        <div className="banner error" style={{ marginBottom: 14 }}>
          <span>{problem}</span>
        </div>
      )}

      <div className="row">
        <button className="btn primary" onClick={save}>
          {saved ? "Saved" : "Save changes"}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            setDraft(settings);
            setKeyInputs({});
          }}
        >
          Discard
        </button>
      </div>
    </>
  );
}
