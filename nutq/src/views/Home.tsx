import { useEffect, useState } from "react";
import {
  api,
  MODE_LABELS,
  type Mode,
  type PendingEntry,
  type Settings,
  type Status,
  type Usage,
  type Quota,
  type HistoryEntry,
} from "../lib/api";

interface Props {
  status: Status;
  settings: Settings;
  ready: boolean;
  pending: PendingEntry[];
  onModeChange: (mode: Mode) => void;
}

/** "1712" -> "28m 32s". Seconds alone stop being readable past a minute. */
function formatDuration(total: number) {
  const s = Math.round(total);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function Home({
  status,
  settings,
  ready,
  pending,
  onModeChange,
}: Props) {
  const [usage, setUsage] = useState<Usage>({
    month_cost: 0,
    month_count: 0,
    today_count: 0,
    today_audio_seconds: 0,
    cost_complete: true,
  });
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [latest, setLatest] = useState<HistoryEntry | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryBusy, setRetryBusy] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Pulled on a timer rather than driven by the result event.
  //
  // "Refetch when a run finishes" is the obvious design and it is the reason
  // these numbers appeared frozen: event delivery into a webview is not
  // reliable here - the same thing the overlay ran into, which is why it polls
  // too - so a missed event left the totals stale until the page was
  // remounted. Two cheap local reads a second beats a number nobody trusts.
  useEffect(() => {
    const pull = () => {
      void api.getUsage().then(setUsage);
      void api.getQuota().then(setQuotas);
      void api.getLatest().then(setLatest);
    };
    pull();
    const t = setInterval(pull, 2000);
    return () => clearInterval(t);
  }, []);

  const busy = status === "transcribing" || status === "refining";
  const recording = status === "recording";

  return (
    <>
      <div className="eyebrow">Voice workspace</div>
      <h1>Ready when you are.</h1>
      <p className="lede">
        Press {settings.hotkey} in any app, speak, then press {settings.hotkey} again.
      </p>

      {/* One horizontal bar instead of a tall panel.
       *
       * The recording controls used to own half the window: a big headline, a
       * centred mic, a waveform and the mode row stacked vertically beside a
       * column of cards. But the controls are pressed by a global hotkey from
       * other applications - this page is where the *text* is read. So the
       * controls compress to a strip, the figures to a row, and everything
       * saved goes to the result. */}
      <div className="stage bar">
        <button
          className={`mic small${recording ? " live" : ""}`}
          disabled={busy || !ready}
          title={ready ? "Start or stop recording" : "Add your API key first"}
          onClick={() => void api.toggle(settings.output)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
            <path d="M18 11a1 1 0 1 0-2 0 4 4 0 0 1-8 0 1 1 0 1 0-2 0 6 6 0 0 0 5 5.9V19H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.1A6 6 0 0 0 18 11z" />
          </svg>
        </button>

        <div className="stage-copy">
          <div className="stage-state">
            {recording ? "Recording" : busy ? "Working" : "Ready"}
          </div>
          <div className="stage-hint">
            {recording ? "Press again to stop" : busy ? "Hang on" : `Press ${settings.hotkey}`}
          </div>
        </div>

        <div className={`wave${recording ? " live" : ""}`}>
          {Array.from({ length: 22 }, (_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 9) * 0.09}s` }} />
          ))}
        </div>

        <div className="segmented">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              className={settings.mode === m ? "on" : ""}
              title={MODE_LABELS[m].hint}
              onClick={() => onModeChange(m)}
            >
              {MODE_LABELS[m].name}
            </button>
          ))}
        </div>
      </div>

      {/* The four figures, side by side and small. */}
      <div className="stats">
        <div className="card">
          <div className="card-label">Hotkey</div>
          <div className="card-big">{settings.hotkey}</div>
          <div className="card-note">
            {settings.output === "instant" ? "pastes where you type" : "opens here"}
          </div>
        </div>

        <div className="card">
          <div className="card-label">Today</div>
          <div className="card-big">{usage.today_count}</div>
          <div className="card-note">
            {formatDuration(usage.today_audio_seconds)} of audio
          </div>
        </div>

        <div className="card">
          <div className="card-label">This month</div>
          <div className="card-big">${usage.month_cost.toFixed(4)}</div>
          <div className="card-note">{usage.month_count} results</div>
        </div>

        <div className="card">
          <div className="card-label">Pipeline</div>
          <div className="card-note" style={{ marginTop: 0 }}>
            {settings.sttModel}
            <br />
            {settings.refineEnabled ? `→ ${settings.refineModel}` : "→ raw transcript"}
          </div>
        </div>
      </div>

      {quotas.some((q) => q.items.length > 0) && (
        <div className="quota">
          {quotas
            .filter((q) => q.items.length > 0)
            .map((q) => (
            <div className="quota-block" key={q.host}>
              <div className="quota-head">
                {q.host}
                <span className="quota-at">
                  {q.at && `· reported ${q.at}`}
                </span>
              </div>
              {/* Usage against the day's allowance, rather than the
                  provider's own "remaining".
                  
                  Groq reports what is free to send *this instant*, and it
                  refills one request every 43 seconds - so dictating any
                  slower than that made it read 1999/2000 forever, no matter
                  how much the day had actually consumed. The limit is theirs
                  and real; the running total is ours. Together they answer
                  the question the raw header could not. */}
              {(() => {
                const req = q.items.find((i) => i.kind === "requests");
                const limit = Number(req?.limit ?? 0);
                const remaining = Number(req?.remaining ?? 0);
                const used = usage.today_count;
                const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                // The instantaneous figure only earns space once it is close
                // enough to bite; the rest of the time it is noise.
                const tight = limit > 0 && remaining < limit * 0.25;

                return (
                  <>
                    <div className="quota-items">
                      <div className="quota-item">
                        <div className="quota-kind">Requests today</div>
                        <div className="quota-nums">
                          <b>{used}</b>
                          {limit > 0 && ` / ${limit}`}
                        </div>
                      </div>
                      <div className="quota-item">
                        <div className="quota-kind">Audio today</div>
                        <div className="quota-nums">
                          <b>{formatDuration(usage.today_audio_seconds)}</b>
                        </div>
                      </div>
                    </div>

                    {limit > 0 && (
                      <div className="quota-bar" title={`${pct.toFixed(1)}% of today`}>
                        <span style={{ width: `${Math.max(pct, 0.6)}%` }} />
                      </div>
                    )}

                    {tight && (
                      <div className="quota-tight">
                        Only {remaining} left to send right now · back to full in{" "}
                        {req?.reset}
                      </div>
                    )}
                  </>
                );
              })()}
              </div>
            ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="pending-box">
          <div className="pending-head">
            <h2 style={{ margin: 0 }}>Pending retries</h2>
            <span className="pill">{pending.length}</span>
          </div>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Calls that failed on every provider. Retrying uses the providers selected in
            Settings right now - fix anything there first, then retry.
          </div>
          {retryError && (
            <div className="diag bad" style={{ marginBottom: 10 }}>
              <div className="diag-detail" style={{ whiteSpace: "pre-wrap" }}>
                {retryError}
              </div>
            </div>
          )}
          {pending.map((p) => (
            <div className="pending-row" key={p.id}>
              <div className="pending-info">
                <div className="pending-title">
                  {p.stage === "transcription" ? "Recording" : "Transcript"} ·{" "}
                  {p.created_at} · {p.seconds.toFixed(1)}s
                </div>
                <div className="pending-err" title={p.error}>
                  {p.error.split("\n")[0]}
                </div>
              </div>
              <div className="row" style={{ flex: "none" }}>
                <button
                  className="btn primary"
                  disabled={retryBusy === p.id || busy}
                  onClick={async () => {
                    setRetryBusy(p.id);
                    setRetryError(null);
                    try {
                      await api.retryPending(p.id);
                    } catch (e) {
                      setRetryError(String(e));
                    } finally {
                      setRetryBusy(null);
                    }
                  }}
                >
                  {retryBusy === p.id ? "Retrying…" : "Retry"}
                </button>
                <button
                  className="btn ghost"
                  disabled={retryBusy === p.id}
                  onClick={() => void api.discardPending(p.id)}
                >
                  Discard
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="result">
        <div className="result-head">
          <h2 style={{ margin: 0 }}>Latest result</h2>
          {latest && <span className="pill">{MODE_LABELS[latest.mode].name}</span>}
          {latest && (
            <span className="pill">
              {latest.seconds.toFixed(1)}s
              {latest.cost_usd > 0 && ` · $${latest.cost_usd.toFixed(5)}`}
            </span>
          )}
          <div className="spacer" />
          <button
            className="btn"
            disabled={!latest}
            onClick={async () => {
              if (!latest) return;
              await api.copyText(latest.refined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Provenance, the same as a history row carries: which model wrote
            this and which microphone heard it. Read from history rather than
            from the result event, so it is still here after a restart. */}
        {latest && (latest.stt_model || latest.microphone) && (
          <div className="result-meta">
            {latest.stt_model && (
              <span className="hist-models">
                {latest.stt_model}
                {latest.stt_via_backup ? " · backup" : ""}
                {latest.refine_model ? ` → ${latest.refine_model}` : " → raw"}
              </span>
            )}
            {latest.microphone && <span className="hist-mic">🎙 {latest.microphone}</span>}
          </div>
        )}

        <div className={`result-text${latest ? "" : " empty"}`} dir="auto">
          {latest ? latest.refined : "Your latest result will appear here."}
        </div>
      </div>
    </>
  );
}
