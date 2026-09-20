import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  api,
  events,
  REFINE_KEY_SLOT,
  STT_KEY_SLOT,
  type HotkeySlot,
  type KeyStatus,
  type LogEntry,
  type PendingEntry,
  type Settings,
  type Status,
  type Theme,
} from "./lib/api";
import { prettyHotkey } from "./lib/hotkeys";
import { applyTheme, Icon, type IconName } from "./lib/ui";
import Home from "./views/Home";
import SettingsView from "./views/SettingsView";
import HistoryView from "./views/HistoryView";
import LogsView from "./views/LogsView";
import TodosView from "./views/TodosView";
import NotesView from "./views/NotesView";

type View = "home" | "notes" | "todos" | "history" | "settings" | "logs";

/** The rail, in two groups: what you work in, and what the app keeps about
 *  itself. Icons are shared with the rest of the app (lib/ui). */
const NAV: { group: string; items: [View, string, IconName][] }[] = [
  {
    group: "Workspace",
    items: [
      ["home", "Home", "home"],
      ["notes", "Notes", "note"],
      ["todos", "To-do", "checklist"],
      ["history", "History", "clock"],
    ],
  },
  {
    group: "App",
    items: [
      ["settings", "Settings", "sliders"],
      ["logs", "Logs", "logs"],
    ],
  },
];

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
    return ["history", "settings", "logs", "todos", "notes"].includes(h)
      ? (h as View)
      : "home";
  });
  const [status, setStatus] = useState<Status>("idle");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<KeyStatus>({});
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [hotkeys, setHotkeys] = useState<HotkeySlot[] | null>(null);
  /** The persistent warning/error log, newest first. */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  /** Ids dismissed from the sidebar; the Logs page still shows them. */
  const [dismissed, setDismissed] = useState<string[]>([]);
  /** The bundle's own version, from the app config, so the sidebar can say
   *  which release is actually running. */
  const [appVersion, setAppVersion] = useState("");
  /** A theme the Settings page is trying on but has not saved. One owner for
   *  the window's appearance means nothing can stomp the preview - which is
   *  exactly what happened when both places painted. */
  const [themePreview, setThemePreview] = useState<Theme | null>(null);

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
    void getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refresh();
    void refreshLogs();
  }, [refresh, refreshLogs]);

  // The chosen theme is written on <html>, where the stylesheet's
  // [data-theme="dark"] block can see it. "system" follows Windows live, so
  // the app changes with it at sunset without a restart.
  const theme = themePreview ?? settings?.theme ?? "system";
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

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

  // Every line with a binding problem earns one line of banner - an unbound
  // key is an app that looks fine and answers nothing.
  const hotkeyProblems: string[] = (hotkeys ?? [])
    .filter((s) => s.state.reset_from || !s.state.bound)
    .map((s) =>
      s.state.reset_from
        ? `Your "${s.name}" hotkey "${s.state.reset_from}" was not a key this app could bind, so ` +
          `it was reset to ${prettyHotkey(s.state.spec)}. Set the one you want in Settings.`
        : `The "${s.name}" hotkey ${prettyHotkey(s.state.spec)} is not active. ${s.state.error}`,
    );
  const missingKeys = missingStt || missingRefine;
  /** Shared by the sidebar toast and the Logs rail dot: something the user has
   *  not dismissed yet. */
  const latestLog = logs.find((l) => !dismissed.includes(l.id));
  const counts: Partial<Record<View, number>> = {
    logs: logs.length || undefined,
  };

  return (
    <div className="shell">
      <aside className="sidebar zone-dark">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div className="brand-text">
            <div className="brand-name">nutq</div>
            <div className="brand-sub">voice to text</div>
          </div>
        </div>

        <nav>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-label">{g.group}</div>
              {g.items.map(([id, label, icon]) => (
                <button
                  key={id}
                  className={`nav-item${view === id ? " active" : ""}`}
                  onClick={() => setView(id)}
                  title={label}
                >
                  <Icon name={icon} size={17} className="nav-ico" />
                  <span className="nav-txt">{label}</span>
                  {counts[id] !== undefined && (
                    <span className="nav-count nums">{counts[id]}</span>
                  )}
                  {id === "logs" && latestLog && (
                    <span
                      className="nav-dot"
                      style={{
                        background:
                          latestLog.level === "error" ? "var(--danger)" : "var(--warn)",
                      }}
                      title={latestLog.message}
                    />
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Messages live in the sidebar's empty middle.
         *
         * They were a block at the top of <main>, which pushed the whole page
         * down whenever one arrived - constantly, with a rate-limited primary
         * provider. Floating over the page fixed the reflow but covered
         * content. This gap is already reserved by the layout and otherwise
         * unused, so a message costs neither movement nor coverage.
         *
         * Only the newest log shows here, and it stays until dismissed - a
         * provider problem that was worked around is still something the user
         * asked to see. The full list lives on the Logs page. */}
        <div className="toasts">
          {latestLog ? (
            <div className={`toast ${latestLog.level}`}>
              <div className="toast-head">
                <span className="toast-kind">{latestLog.level}</span>
                <span className="log-time">{latestLog.at}</span>
              </div>
              <div className="toast-text">{latestLog.message}</div>
              <div className="toast-actions">
                <button onClick={() => void api.copyText(latestLog.message)}>Copy</button>
                <button onClick={() => setDismissed((d) => [...d, latestLog.id])}>
                  Dismiss
                </button>
                <button onClick={() => setView("logs")}>Details</button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="sidebar-foot">
          <div
            className={
              "status-chip" +
              (status === "recording" ? " live" : status === "idle" ? "" : " busy")
            }
          >
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
          {appVersion && <div className="foot-version">version {appVersion}</div>}
        </div>
      </aside>

      <main className="main">
        <div className="page">
          {/* A hotkey problem is decided during startup, before this window
              exists to be told about it, so it is asked for rather than pushed.
              It is worth a banner: the app has no other way in, and silence was
              precisely what made the last one hard to diagnose. */}
          {hotkeyProblems.length > 0 && view !== "settings" && (
            <div className="banner warn">
              <Icon name="alert" size={18} className="banner-ico" />
              <div className="banner-text">{hotkeyProblems[0]}</div>
              <div className="banner-actions">
                <button className="btn sm" onClick={() => setView("settings")}>
                  Open settings
                </button>
              </div>
            </div>
          )}
          {missingKeys && view !== "settings" && (
            <div className="banner warn">
              <Icon name="key" size={18} className="banner-ico" />
              <div className="banner-text">
                {missingStt
                  ? "No API key saved for the transcription provider you selected. Nothing can be transcribed until one is."
                  : "Refinement is on but no API key is saved for its provider."}
              </div>
              <div className="banner-actions">
                <button className="btn sm" onClick={() => setView("settings")}>
                  Add the key
                </button>
              </div>
            </div>
          )}

          {view === "home" && (
            <Home
              status={status}
              settings={settings}
              ready={!missingKeys}
              pending={pending}
              appVersion={appVersion}
              onOpenSettings={() => setView("settings")}
            />
          )}
          {view === "todos" && <TodosView />}
          {view === "notes" && <NotesView />}
          {view === "history" && <HistoryView />}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              keys={keys}
              onSave={saveSettings}
              onPreviewTheme={setThemePreview}
            />
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
        </div>
      </main>
    </div>
  );
}
