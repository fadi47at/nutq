import { useEffect, useState } from "react";
import {
  api,
  MODE_LABELS,
  type PendingEntry,
  type Profile,
  type Settings,
  type Status,
  type Usage,
  type Quota,
  type HistoryEntry,
} from "../lib/api";
import { Icon, Kbd, PageHead } from "../lib/ui";

interface Props {
  status: Status;
  settings: Settings;
  ready: boolean;
  pending: PendingEntry[];
  appVersion: string;
  onOpenSettings: () => void;
}

/** "1712" -> "28m 32s". Seconds alone stop being readable past a minute. */
function formatDuration(total: number) {
  const s = Math.round(total);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Where a line's finished text goes, in three words. */
const OUTPUT_LABELS: Record<Profile["output"], string> = {
  instant: "pastes in place",
  draft: "waits here",
  notes: "files a note",
};

const STATE_COPY: Record<Status, { name: string; sub: string }> = {
  idle: { name: "Ready", sub: "press a hotkey anywhere, or click a line" },
  recording: { name: "Listening", sub: "press the same key again to finish" },
  transcribing: { name: "Transcribing", sub: "sending the audio to the model" },
  refining: { name: "Refining", sub: "turning the transcript into the finished text" },
};

export default function Home({
  status,
  settings,
  ready,
  pending,
  appVersion,
  onOpenSettings,
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
  /** A newer release on GitHub, when one exists. The update card shows only
   *  then - otherwise the page stays exactly as it was. */
  const [update, setUpdate] = useState<{ version: string; notes: string } | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  /** What the manual check wants said: up to date, or why not. */
  const [checkNote, setCheckNote] = useState<string | null>(null);

  // One check when the page opens and one every four hours after that - enough
  // to catch a release the same day without polling GitHub on every visit.
  // Being offline is not an error worth showing: the card simply stays hidden
  // and the next tick tries again.
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
    const t = setInterval(() => void check(), 4 * 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // The manual twin of the automatic check, for "a release just went out and I
  // want it NOW" - no waiting for a restart or the four-hour tick.
  async function checkNow() {
    setCheckBusy(true);
    setCheckNote(null);
    try {
      const u = await api.checkForUpdate();
      if (u) setUpdate(u);
      else setCheckNote(`v${appVersion} is the latest`);
    } catch {
      setCheckNote("couldn't reach GitHub");
    } finally {
      setCheckBusy(false);
    }
  }

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
  const lines: Profile[] = settings.profiles;
  /** The line currently being captured, so its tile shows "live". The pill on
   *  screen carries the same name from the overlay's poll. */
  const [activeLine, setActiveLine] = useState<string | null>(null);
  useEffect(() => {
    setActiveLine(recording ? activeLine : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const state = STATE_COPY[status];
  const liveQuotas = quotas.filter((q) => q.items.length > 0);

  return (
    <>
      <PageHead
        eyebrow="Voice workspace"
        title="Ready when you are."
        lede={
          lines.length
            ? "Press a line's hotkey in any app, speak, and press it again. The finished text lands where that line sends it."
            : "No dictation lines yet - add one in Settings and it gets a hotkey and a button here."
        }
        actions={
          <>
            {checkNote && <span className="chip">{checkNote}</span>}
            <button
              className="btn ghost"
              disabled={checkBusy || updateBusy}
              onClick={() => void checkNow()}
            >
              <Icon name="refresh" size={15} />
              {checkBusy ? "Checking…" : "Check for updates"}
            </button>
          </>
        }
      />

      <div className="stack">
        {update && (
          <div className="card">
            <div className="card-head">
              <Icon name="download" size={17} />
              <h2>A newer version is out</h2>
              <span className="chip accent">v{update.version}</span>
              <span className="chip plain">you have v{appVersion}</span>
            </div>
            <div className="card-body">
              <div className="hint" style={{ marginBottom: 12 }}>
                {update.notes
                  ? update.notes.split("\n")[0]
                  : "Download, install, restart - all in one click."}
              </div>
              {updateError && (
                <div className="diag bad">
                  <div className="diag-detail">{updateError}</div>
                </div>
              )}
              <div className="row">
                <button
                  className="btn primary"
                  disabled={updateBusy}
                  onClick={() => {
                    setUpdateBusy(true);
                    setUpdateError(null);
                    void api
                      .installUpdate()
                      .catch((e) => setUpdateError(String(e)))
                      .finally(() => setUpdateBusy(false));
                  }}
                >
                  {updateBusy ? "Downloading and installing…" : "Update now"}
                </button>
                <button
                  className="btn ghost"
                  disabled={updateBusy}
                  onClick={() => setUpdate(null)}
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div className="card">
            <div className="card-head">
              <Icon name="alert" size={17} />
              <h2>Waiting to be retried</h2>
              <span className="chip warn">{pending.length}</span>
            </div>
            <div className="card-body">
              <div className="hint dim" style={{ marginBottom: 10 }}>
                Calls that failed on every provider. Retrying uses the providers
                selected in Settings right now - fix anything there first, then
                retry.
              </div>
              {retryError && (
                <div className="diag bad">
                  <div className="diag-detail">{retryError}</div>
                </div>
              )}
              {pending.map((p) => (
                <div className="pending-row" key={p.id}>
                  <div style={{ minWidth: 0 }}>
                    <div className="pending-title">
                      {p.stage === "transcription" ? "Recording" : "Transcript"} ·{" "}
                      {p.created_at} · {p.seconds.toFixed(1)}s
                    </div>
                    <div className="pending-err" title={p.error}>
                      {p.error.split("\n")[0]}
                    </div>
                  </div>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <button
                      className="btn primary sm"
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
                      className="btn ghost sm"
                      disabled={retryBusy === p.id}
                      onClick={() => void api.discardPending(p.id)}
                    >
                      Discard
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* The launcher.
         *
         * The recording controls used to own half the window: a big headline, a
         * centred mic, a waveform and a mode row stacked vertically beside a
         * column of cards. But they are pressed by a global hotkey from other
         * applications - this page is where the *text* is read. So the controls
         * get one card, the figures a row, and everything saved goes to the
         * result. */}
        <div className="card launcher">
          <div className="launcher-head">
            <div>
              <div className="launcher-state">
                <span
                  className={
                    "dot" +
                    (recording ? " rec" : status === "idle" ? "" : " busy")
                  }
                />
                {state.name}
              </div>
              <div className="launcher-sub">{state.sub}</div>
            </div>
            <div className={`wave${recording ? " live" : ""}`}>
              {Array.from({ length: 24 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${(i % 9) * 0.09}s` }} />
              ))}
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="card-body">
              <button className="btn primary" onClick={onOpenSettings}>
                <Icon name="plus" size={15} />
                Add your first line
              </button>
            </div>
          ) : (
            <div className="line-grid">
              {lines.map((p) => {
                const live = activeLine === p.id && recording;
                return (
                  <button
                    key={p.id}
                    className={`line-btn${live ? " live" : ""}`}
                    disabled={busy || !ready}
                    title={
                      MODE_LABELS[p.mode].hint +
                      (p.custom_prompt.trim() ? " · custom instructions" : "")
                    }
                    onClick={() => {
                      setActiveLine(p.id);
                      void api.toggle(p.id);
                    }}
                  >
                    <span className="line-name">
                      {p.name}
                      {live && <span className="dot rec" />}
                    </span>
                    <Kbd spec={p.hotkey} />
                    <span className="line-meta">
                      {p.custom_prompt.trim()
                        ? "custom instructions"
                        : MODE_LABELS[p.mode].name}{" "}
                      · {OUTPUT_LABELS[p.output]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* The four figures, side by side and small. */}
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Lines</div>
            <div className="stat-value">{lines.length}</div>
            <div className="stat-note">
              {lines[0] ? `${lines[0].name} starts the list` : "add one in Settings"}
            </div>
          </div>

          <div className="stat">
            <div className="stat-label">Today</div>
            <div className="stat-value">{usage.today_count}</div>
            <div className="stat-note">
              {formatDuration(usage.today_audio_seconds)} of audio
            </div>
          </div>

          <div className="stat">
            <div className="stat-label">This month</div>
            <div className="stat-value">${usage.month_cost.toFixed(4)}</div>
            <div className="stat-note">
              {usage.month_count} results
              {!usage.cost_complete && " · some providers untracked"}
            </div>
          </div>

          <div className="stat">
            <div className="stat-label">Pipeline</div>
            <div className="stat-chain">
              <span>
                <em>hear</em>
                <b title={settings.sttModel}>{settings.sttModel}</b>
              </span>
              <span>
                <em>write</em>
                <b title={settings.refineEnabled ? settings.refineModel : "raw transcript"}>
                  {settings.refineEnabled ? settings.refineModel : "raw transcript"}
                </b>
              </span>
            </div>
          </div>
        </div>

        {liveQuotas.length > 0 && (
          <div className="card">
            <div className="card-head">
              <Icon name="bolt" size={16} />
              <h2>Provider allowance</h2>
            </div>
            <div className="card-body">
              {liveQuotas.map((q) => (
                <div className="quota-block" key={q.host}>
                  <div className="quota-head">
                    <span className="quota-host">{q.host}</span>
                    {q.at && <span className="quota-at">reported {q.at}</span>}
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
                          <div>
                            <div className="quota-kind">Requests today</div>
                            <div className="quota-nums">
                              <b>{used}</b>
                              {limit > 0 && ` / ${limit}`}
                            </div>
                          </div>
                          <div>
                            <div className="quota-kind">Audio today</div>
                            <div className="quota-nums">
                              <b>{formatDuration(usage.today_audio_seconds)}</b>
                            </div>
                          </div>
                        </div>

                        {limit > 0 && (
                          <div
                            className={`quota-bar${tight ? " tight" : ""}`}
                            title={`${pct.toFixed(1)}% of today's allowance`}
                          >
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
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <Icon name="chat" size={17} />
            <h2>Latest result</h2>
            {latest && <span className="chip">{MODE_LABELS[latest.mode].name}</span>}
            {latest && (
              <span className="chip nums">
                {latest.seconds.toFixed(1)}s
                {latest.cost_usd > 0 && ` · $${latest.cost_usd.toFixed(5)}`}
              </span>
            )}
            <div className="spacer" />
            <button
              className="btn sm"
              disabled={!latest}
              onClick={async () => {
                if (!latest) return;
                await api.copyText(latest.refined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Icon name={copied ? "check" : "copy"} size={15} />
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="card-body">
            {/* Provenance, the same as a history row carries: which model wrote
                this and which microphone heard it. Read from history rather
                than from the result event, so it is still here after a
                restart. */}
            {latest && (latest.stt_model || latest.microphone) && (
              <div className="meta-row">
                {latest.stt_model && (
                  <span className="hist-models">
                    {latest.stt_model}
                    {latest.stt_via_backup ? " · backup" : ""}
                    {latest.refine_model ? ` → ${latest.refine_model}` : " → raw"}
                  </span>
                )}
                {latest.microphone && (
                  <span className="hist-mic">🎙 {latest.microphone}</span>
                )}
              </div>
            )}

            <div className={`result-text${latest ? "" : " empty-text"}`} dir="auto">
              {latest ? latest.refined : "Your latest result will appear here."}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
