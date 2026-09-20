import type { LogEntry } from "../lib/api";
import { api } from "../lib/api";
import { Empty, Icon, PageHead } from "../lib/ui";

/**
 * The full warning/error log, newest first. Every entry was also a rail message
 * at some point - this page is why missing one costs nothing.
 */
export default function LogsView({
  logs,
  onClear,
}: {
  logs: LogEntry[];
  onClear: () => void;
}) {
  const errors = logs.filter((l) => l.level === "error").length;

  return (
    <>
      <PageHead
        eyebrow="Diagnostics"
        title="Logs"
        lede="Warnings and errors this app has run into, newest first, kept on this machine only. The newest of these is what the sidebar shows."
        actions={
          logs.length > 0 ? (
            <button className="btn" onClick={onClear}>
              <Icon name="trash" size={15} />
              Clear log
            </button>
          ) : null
        }
      />

      {logs.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="chip">{logs.length} entries</span>
          {errors > 0 && <span className="chip bad">{errors} errors</span>}
          {errors === 0 && <span className="chip ok">no errors</span>}
        </div>
      )}

      {logs.length === 0 ? (
        <Empty
          icon="check"
          title="Nothing logged"
          sub="Quiet is good. Anything that goes wrong with a provider, a key, or a hotkey lands here."
        />
      ) : (
        logs.map((l) => (
          <div className={`log-row ${l.level}`} key={l.id}>
            <div className="log-head">
              <span className={`chip ${l.level === "error" ? "bad" : "warn"}`}>
                {l.level}
              </span>
              <span className="log-time">{l.at}</span>
              <div className="spacer" />
              <button
                className="icon-btn"
                title="Copy this message"
                onClick={() => void api.copyText(l.message)}
              >
                <Icon name="copy" />
              </button>
            </div>
            <div className="log-msg" dir="auto">
              {l.message}
            </div>
          </div>
        ))
      )}
    </>
  );
}
