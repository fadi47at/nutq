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
import { applyDirection, setLanguage, t, type UiLanguage } from "./lib/i18n";
import { prettyHotkey } from "./lib/hotkeys";
import { applyTheme, Icon, type IconName } from "./lib/ui";
import Home from "./views/Home";
import SettingsView from "./views/SettingsView";
import HistoryView from "./views/HistoryView";
import LogsView from "./views/LogsView";
import TodosView from "./views/TodosView";
import NotesView from "./views/NotesView";
import ThreadsView from "./views/ThreadsView";

type View = "home" | "threads" | "notes" | "todos" | "history" | "settings" | "logs";

/** The rail, in two groups: what you work in, and what the app keeps about
 *  itself. Icons are shared with the rest of the app (lib/ui). Labels are
 *  English source text, translated where they are drawn. */
const NAV: { group: string; items: [View, string, IconName][] }[] = [
  {
    group: "Workspace",
    items: [
      ["home", "Home", "home"],
      ["threads", "Idea threads", "sprout"],
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

const STATUS_NAME: Record<Status, string> = {
  idle: "idle",
  recording: "recording",
  transcribing: "transcribing",
  refining: "refining",
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
    return ["history", "settings", "logs", "todos", "notes", "threads"].includes(h)
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
  /** The same arrangement for the interface language: Settings tries it on,
   *  App owns what the window actually speaks. */
  const [languagePreview, setLanguagePreview] = useState<UiLanguage | null>(null);
  /** A newer release on GitHub, when one exists. Owned here so both the Home
   *  card and the sidebar's notice speak of the same thing. */
  const [update, setUpdate] = useState<{ version: string; notes: string } | null>(null);
  /** The version the user put off - its notice stays away until a newer one
   *  exists. Cleared by "Dismiss all" too. */
  const [dismissedUpdate, setDismissedUpdate] = useState<string | null>(null);

  // One check on launch and one every ten minutes after that. The check is a
  // single small request to GitHub, invisible when offline; ten minutes keeps
  // a fresh release noticeable the same hour without polling anyone hard.
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const u = await api.checkForUpdate();
        if (alive) setUpdate(u);
      } catch {
        /* offline or the endpoint is unreachable - nothing to offer */
      }
    };
    void check();
    const timer = setInterval(() => void check(), 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

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

  // The tray icon shows a green dot while an update is on offer and goes
  // back to plain once it is installed or put off. Fire-and-forget: a tray
  // that cannot be badged is cosmetic, never a broken app.
  const hasUpdate = update !== null;
  useEffect(() => {
    api.setUpdateBadge(hasUpdate).catch(() => {});
  }, [hasUpdate]);

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

  // The language is set during render, not after it, so this very render -
  // and every page under it - already speaks the new one. The DOM half
  // (lang, dir) follows in an effect.
  const uiLanguage = languagePreview ?? settings?.uiLanguage ?? "system";
  setLanguage(uiLanguage);
  useEffect(() => {
    applyDirection();
  }, [uiLanguage]);

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
        ? t(
            'Your "{name}" hotkey "{from}" was not a key this app could bind, so it was reset to {to}. Set the one you want in Settings.',
            { name: s.name, from: s.state.reset_from, to: prettyHotkey(s.state.spec) },
          )
        : t('The "{name}" hotkey {key} is not active.', {
            name: s.name,
            key: prettyHotkey(s.state.spec),
          }) + ` ${s.state.error}`,
    );
  const missingKeys = missingStt || missingRefine;
  /** Shared by the sidebar toast and the Logs rail dot: something the user has
   *  not dismissed yet. */
  const pendingLogs = logs.filter((l) => !dismissed.includes(l.id));
  const latestLog = pendingLogs[0];
  /** The update notice is dismissed per version: putting v10 off does not
   *  hide v11 when it ships. */
  const updateNotice =
    update && update.version !== dismissedUpdate ? update : null;
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
            <div className="brand-sub">{t("voice to text")}</div>
          </div>
        </div>

        <nav>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-label">{t(g.group)}</div>
              {g.items.map(([id, label, icon]) => (
                <button
                  key={id}
                  className={`nav-item${view === id ? " active" : ""}`}
                  onClick={() => setView(id)}
                  title={t(label)}
                >
                  <Icon name={icon} size={17} className="nav-ico" />
                  <span className="nav-txt">{t(label)}</span>
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
          {/* The update notice rides the same slot as the log toast: one
           *  place to look, one Dismiss gesture, and Home keeps the card
           *  that does the actual installing. */}
          {updateNotice ? (
            <div className="toast info">
              <div className="toast-head">
                <span className="toast-kind">{t("Update")}</span>
              </div>
              <div className="toast-text">
                {t("A new version is available: v{version}.", {
                  version: updateNotice.version,
                })}
              </div>
              <div className="toast-actions">
                <button onClick={() => setView("home")}>{t("Details")}</button>
                <button onClick={() => setDismissedUpdate(updateNotice.version)}>
                  {t("Dismiss")}
                </button>
              </div>
            </div>
          ) : null}
          {latestLog ? (
            <div className={`toast ${latestLog.level}`}>
              <div className="toast-head">
                <span className="toast-kind">{t(latestLog.level)}</span>
                <span className="log-time">{latestLog.at}</span>
              </div>
              <div className="toast-text" dir="auto">
                {latestLog.message}
              </div>
              <div className="toast-actions">
                <button onClick={() => void api.copyText(latestLog.message)}>
                  {t("Copy")}
                </button>
                {/* One Dismiss clears the whole pile. Dismissing only the
                 *  newest notice used to uncover the one before it, then the
                 *  one before that - a queue the user never asked to drain
                 *  by hand. The full history stays on the Logs page. */}
                <button
                  onClick={() =>
                    setDismissed((d) => [
                      ...d,
                      ...pendingLogs.map((l) => l.id).filter((id) => !d.includes(id)),
                    ])
                  }
                >
                  {t("Dismiss")}
                </button>
                <button onClick={() => setView("logs")}>{t("Details")}</button>
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
              <div className="status-name">{t(STATUS_NAME[status])}</div>
              <div className="status-sub">{t(STATUS_SUB[status])}</div>
            </div>
          </div>
          {appVersion && (
            <div className="foot-version">{t("version {v}", { v: appVersion })}</div>
          )}
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
                  {t("Open settings")}
                </button>
              </div>
            </div>
          )}
          {missingKeys && view !== "settings" && (
            <div className="banner warn">
              <Icon name="key" size={18} className="banner-ico" />
              <div className="banner-text">
                {missingStt
                  ? t(
                      "No API key saved for the transcription provider you selected. Nothing can be transcribed until one is.",
                    )
                  : t("Refinement is on but no API key is saved for its provider.")}
              </div>
              <div className="banner-actions">
                <button className="btn sm" onClick={() => setView("settings")}>
                  {t("Add the key")}
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
              update={update}
              onClearUpdate={() => setUpdate(null)}
            />
          )}
          {view === "todos" && <TodosView />}
          {view === "threads" && <ThreadsView lines={settings.profiles} />}
          {view === "notes" && <NotesView />}
          {view === "history" && <HistoryView />}
          {view === "settings" && (
            <SettingsView
              settings={settings}
              keys={keys}
              appVersion={appVersion}
              onSave={saveSettings}
              onPreviewTheme={setThemePreview}
              onPreviewLanguage={setLanguagePreview}
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
