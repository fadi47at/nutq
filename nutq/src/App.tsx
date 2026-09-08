import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  api,
  events,
  REFINE_KEY_SLOT,
  STT_KEY_SLOT,
  type HotkeyReport,
  type KeyStatus,
  type LogEntry,
  type PendingEntry,
  type Settings,
  type Status,
} from "./lib/api";
import { prettyHotkey } from "./lib/hotkeys";
import Home from "./views/Home";
import SettingsView from "./views/SettingsView";
import HistoryView from "./views/HistoryView";
import LogsView from "./views/LogsView";

type View = "home" | "history" | "settings" | "logs";

/** One drawn glyph per page, so the sidebar can fold to a rail of icons when
 *  the window gets phone-sized. Stroke-based on a 20px grid. */
const NAV_ICONS: Record<View, ReactElement> = {
  home: (
    <>
      <path d="M3.6 10.1 10 4.4l6.4 5.7" />
      <path d="M5.4 9.2v7.2h9.2V9.2" />
    </>
  ),
  history: (
    <>
      <circle cx="10" cy="10" r="6.3" />
      <path d="M10 6.7V10l2.4 1.6" />
    </>
  ),
  settings: (
    <>
      <path d="M4.2 6.2h11.6M4.2 10h11.6M4.2 13.8h11.6" />
      <circle cx="8" cy="6.2" r="1.7" />
      <circle cx="12.6" cy="10" r="1.7" />
      <circle cx="7.2" cy="13.8" r="1.7" />
    </>
  ),
  logs: (
    <>
      <rect x="4.6" y="3.6" width="10.8" height="12.8" rx="1.6" />
      <path d="M7.4 7.4h5.2M7.4 10h5.2M7.4 12.6h3.2" />
    </>
  ),
};

const STATUS_SUB: Record<Status, string> = {
  idle: "waiting for your hotkey",
  recording: "listening",
  transcribing: "transcribing",
  refining: "refining",
};

export default function App() {
  // Deep link: "#history" and friends open that page directly. The overlay
  // bundle already picks its world from the hash (#overlay), so a page hash
  // costs nothing and makes every page reachable from a shortcut.
  const [view, setView] = useState<View>(() => {
    const h = window.location.hash.replace(/^#/, "");
    return h === "history" || h === "settings" || h === "logs" ? (h as View) : "home";
  });
  const [status, setStatus] = useState<Status>("idle");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<KeyStatus>({});
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [hotkeys, setHotkeys] = useState<HotkeyReport | null>(null);
  /** The persistent warning/error log, newest first. */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  /** Ids dismissed from the sidebar; the Logs page still shows them. */
  const [dismissed, setDismissed] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const [s, k, st, p, hk] = await Promise.all([
      api.getSettings(),
      api.keyStatus(),
      api.getStatus(),
      api.getPending(),
      api.hotkeyStatus(),
    ]);
    setSettings(s);
    setKeys(k);
    setStatus(st);
    setPending(p);
    setHotkeys(hk);
  }, []);

  const refreshLogs = useCallback(async () => {
    setLogs(await api.getLogs());
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLogs();
  }, [refresh, refreshLogs]);

  useEffect(() => {
    const unlisteners = [
      events.onStatus(setStatus),
      events.onResult((r) => {
        // A draft-mode result is the reason the window came forward, so land
        // the user on the page that shows it.
        if (r.output === "draft") setView("home");
      }),
      // The backend files every warning and error into the persistent log
      // before emitting it, so re-reading the log is the whole update.
      events.onWarning(() => void refreshLogs()),
      events.onError(() => void refreshLogs()),
      events.onPendingChanged(() => {
        void api.getPending().then(setPending);
      }),
    ];
    return () => {
      unlisteners.forEach((p) => void p.then((un) => un()));
    };
  }, [refreshLogs]);

  const saveSettings = useCallback(async (next: Settings) => {
    await api.saveSettings(next);
    setSettings(next);
    setKeys(await api.keyStatus());
  }, []);

  if (!settings) return null;

  // Only the slots the selected providers actually read - an unused ElevenLabs
  // key being absent is not a problem worth a banner.
  const sttSlot = STT_KEY_SLOT[settings.sttProvider];
  const refineSlot = REFINE_KEY_SLOT[settings.refineProvider];
  const missingStt = !keys[sttSlot];
  const missingRefine = settings.refineEnabled && !keys[refineSlot];

  const dictate = hotkeys?.dictate;
  const hotkeyProblem = dictate?.reset_from
    ? `Your dictate hotkey "${dictate.reset_from}" was not a key this app could bind, so it ` +
      `was reset to ${prettyHotkey(dictate.spec)}. Set the one you want in Settings.`
    : dictate && !dictate.bound
      ? `The dictate hotkey ${prettyHotkey(dictate.spec)} is not active. ${dictate.error}`
      : null;
  const missingKeys = missingStt || missingRefine;
  /** Shared by the sidebar toast and the Logs rail dot: something the user
   *  has not dismissed yet. */
  const latestLog = logs.find((l) => !dismissed.includes(l.id));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <div className="brand-name">nutq</div>
            <div className="brand-sub">voice to text</div>
          </div>
        </div>

        <div className="nav-label">Workspace</div>
        {(
          [
            ["home", "Home"],
            ["history", "History"],
            ["settings", "Settings"],
            ["logs", "Logs"],
          ] as [View, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`nav-item${view === id ? " active" : ""}`}
            onClick={() => setView(id)}
            title={label}
          >
            <svg
              className="nav-ico"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {NAV_ICONS[id]}
            </svg>
            <span className="nav-txt">{label}</span>
            {id === "logs" && latestLog && (
              <span
                className="nav-dot"
                style={{
                  background: latestLog.level === "error" ? "var(--danger)" : "var(--warn)",
                }}
                title={latestLog.message}
              />
            )}
          </button>
        ))}

        {/* Messages live in the sidebar's empty middle.
         *
         * They were a block at the top of <main>, which pushed the whole page
         * down whenever one arrived - constantly, with a rate-limited primary
         * provider. Floating over the page fixed the reflow but covered
         * content. This gap is already reserved by the layout and otherwise
         * unused, so a message costs neither movement nor coverage.
         *
         * Only the newest log shows here, and it stays until dismissed -
         * a provider problem that was worked around is still something the
         * user asked to see. The full list lives on the Logs page. */}
        <div className="toasts">
          {latestLog ? (
            <div className={`toast ${latestLog.level}`}>
              <div className="toast-head">
                <span className="log-time">{latestLog.at}</span>
              </div>
              <div className="toast-text">{latestLog.message}</div>
              <div className="toast-actions">
                <button onClick={() => void api.copyText(latestLog.message)}>
                  Copy
                </button>
                <button
                  onClick={() => setDismissed((d) => [...d, latestLog.id])}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="sidebar-foot">
          <div className="status-chip">
            <span
              className={
                "dot" +
                (status === "recording" ? " rec" : status === "idle" ? "" : " busy")
              }
            />
            <div className="status-txt">
              <div className="status-name">{status}</div>
              <div className="status-sub">{STATUS_SUB[status]}</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        {/* A hotkey problem is decided during startup, before this window
            exists to be told about it, so it is asked for rather than pushed.
            It is worth a banner: the app has no other way in, and silence was
            precisely what made the last one hard to diagnose. */}
        {hotkeyProblem && view !== "settings" && (
          <div className="banner warn">
            <div className="banner-text">{hotkeyProblem}</div>
            <div className="banner-actions">
              <button onClick={() => setView("settings")}>Open settings</button>
            </div>
          </div>
        )}
        {missingKeys && view !== "settings" && (
          <div className="banner warn">
            <div className="banner-text">
              {missingStt
                ? "No API key saved for the transcription provider you selected."
                : "Refinement is on but no API key is saved for its provider."}
            </div>
            <div className="banner-actions">
              <button onClick={() => setView("settings")}>Open settings</button>
            </div>
          </div>
        )}

        {view === "home" && (
          <Home
            status={status}
            settings={settings}
            ready={!missingKeys}
            pending={pending}
            onModeChange={async (mode) => {
              await api.setMode(mode);
              setSettings({ ...settings, mode });
            }}
          />
        )}
        {view === "history" && <HistoryView />}
        {view === "settings" && (
          <SettingsView settings={settings} keys={keys} onSave={saveSettings} />
        )}
        {view === "logs" && (
          <LogsView
            logs={logs}
            onClear={() => {
              void api.clearLogs().then(refreshLogs);
              setDismissed([]);
            }}
          />
        )}
      </main>
    </div>
  );
}
