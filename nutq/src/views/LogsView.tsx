import type { LogEntry } from "../lib/api";

/**
 * The full warning/error log, newest first. Every entry was also a toast at
 * some point - this page is why missing the toast costs nothing.
 */
export default function LogsView({
  logs,
  onClear,
}: {
  logs: LogEntry[];
  onClear: () => void;
}) {
  return (
    <>
      <div className="eyebrow">Diagnostics</div>
      <h1>Logs</h1>
      <p className="lede">
        Warnings and errors this app has run into, newest first, kept on this
        machine only. The newest of these is what the sidebar shows.
      </p>

      {logs.length > 0 && (
        <div className="row" style={{ marginBottom: 18 }}>
          <button className="btn ghost" onClick={onClear}>
            Clear log
          </button>
        </div>
      )}

      {logs.length === 0 ? (
        <div className="empty-state">Nothing logged. Quiet is good.</div>
      ) : (
        logs.map((l) => (
          <div className="log-row" key={l.id}>
            <div className="log-head">
              <span className={`pill log-level ${l.level}`}>{l.level}</span>
              <span className="log-time">{l.at}</span>
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
