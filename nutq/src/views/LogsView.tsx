import { useState } from "react";
import type { LogEntry } from "../lib/api";
import { api, logSummary } from "../lib/api";
import { t } from "../lib/i18n";
import { Empty, Icon, PageHead } from "../lib/ui";

type Filter = "all" | LogEntry["level"];

/** What each level is called on its chip. A notice is not a problem, and
 *  is not dressed as one. */
const LEVEL_NAME: Record<LogEntry["level"], string> = {
  error: "error",
  warning: "warning",
  notice: "notice",
};

const LEVEL_CHIP: Record<LogEntry["level"], string> = {
  error: "bad",
  warning: "warn",
  notice: "plain",
};

/**
 * The full log, newest first: errors (something did not happen), warnings
 * (something may need you) and notices (worth knowing, needs nothing).
 * Every entry was also a rail message at some point - this page is why
 * missing one costs nothing.
 */
export default function LogsView({
  logs,
  onClear,
}: {
  logs: LogEntry[];
  onClear: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  /** Entries whose details (provider reply, URL) are unfolded. */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const count = (level: LogEntry["level"]) => logs.filter((l) => l.level === level).length;
  const shown = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  return (
    <>
      <PageHead
        eyebrow={t("Diagnostics")}
        title={t("Logs")}
        lede={t(
          "What the app has run into, newest first, kept on this machine only: errors, warnings, and notices that need nothing from you. The newest of these is what the sidebar shows.",
        )}
        actions={
          logs.length > 0 ? (
            <button className="btn" onClick={onClear}>
              <Icon name="trash" size={15} />
              {t("Clear log")}
            </button>
          ) : null
        }
      />

      {logs.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="segmented">
            {(
              [
                ["all", t("All ({n})", { n: logs.length })],
                ["error", t("Errors ({n})", { n: count("error") })],
                ["warning", t("Warnings ({n})", { n: count("warning") })],
                ["notice", t("Notices ({n})", { n: count("notice") })],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                className={filter === id ? "on" : ""}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty
          icon="check"
          title={t("Nothing logged")}
          sub={t(
            "Quiet is good. Anything that goes wrong with a provider, a key, or a hotkey lands here.",
          )}
        />
      ) : (
        shown.map((l) => {
          const { summary, detail } = logSummary(l.message);
          return (
            <div className={`log-row ${l.level}`} key={l.id}>
              <div className="log-head">
                <span className={`chip ${LEVEL_CHIP[l.level] ?? "plain"}`}>
                  {t(LEVEL_NAME[l.level] ?? l.level)}
                </span>
                <span className="log-time">{l.at}</span>
                <div className="spacer" />
                <button
                  className="icon-btn"
                  title={t("Copy this message")}
                  aria-label={t("Copy this message")}
                  onClick={() => void api.copyText(l.message)}
                >
                  <Icon name="copy" />
                </button>
              </div>
              <div className="log-summary" dir="auto">
                {summary}
              </div>
              {detail && (
                <>
                  <button
                    className="link log-more"
                    onClick={() => setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))}
                  >
                    {open[l.id] ? t("Hide the details") : t("Show the details")}
                  </button>
                  {open[l.id] && (
                    <div className="log-msg" dir="auto">
                      {detail}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}
    </>
  );
}
