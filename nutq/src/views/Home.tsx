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
import { t } from "../lib/i18n";
import { Icon, Kbd, lineIcon, PageHead } from "../lib/ui";

interface Props {
  status: Status;
  settings: Settings;
  ready: boolean;
  pending: PendingEntry[];
  appVersion: string;
  onOpenSettings: () => void;
  /** A newer release on GitHub, when one exists. Owned by App so the
   *  sidebar can announce it too; cleared here when the user puts it off. */
  update: { version: string; notes: string } | null;
  onClearUpdate: () => void;
}

/** "1712" -> "28m 32s". Seconds alone stop being readable past a minute. */
function formatDuration(total: number) {
  const s = Math.round(total);
  if (s < 60) return t("{s}s", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("{m}m {s}s", { m, s: s % 60 });
  return t("{h}h {m}m", { h: Math.floor(m / 60), m: m % 60 });
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
  update,
  onClearUpdate,
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
  /** Same one-at-a-time feedback, for the copy-the-recording button. */
  const [copiedClip, setCopiedClip] = useState(false);
  const [retryBusy, setRetryBusy] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

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
    const timer = setInterval(pull, 2000);
    return () => clearInterval(timer);
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
        hero
        eyebrow={t("Voice workspace")}
        title={t("Ready when you are.")}
        lede={
          lines.length
            ? t(
                "Press a line's hotkey in any app, speak, and press it again. The finished text lands where that line sends it.",
              )
            : t(
                "No dictation lines yet - add one in Settings and it gets a hotkey and a button here.",
              )
        }
      />

      <div className="stack">
        {update && (
          <div className="card">
            <div className="card-head">
              <Icon name="download" size={17} />
              <h2>{t("A newer version is out")}</h2>
              <span className="chip accent">v{update.version}</span>
              <span className="chip plain">{t("you have v{v}", { v: appVersion })}</span>
            </div>
            <div className="card-body">
              <div className="hint" style={{ marginBottom: 12, whiteSpace: "pre-line" }}>
                {update.notes
                  ? update.notes
                  : t("Download, install, restart - all in one click.")}
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
                  {updateBusy ? t("Downloading and installing…") : t("Update now")}
                </button>
                <button
                  className="btn ghost"
                  disabled={updateBusy}
                  onClick={onClearUpdate}
                >
                  {t("Later")}
                </button>
              </div>
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div className="card">
            <div className="card-head">
              <Icon name="alert" size={17} />
              <h2>{t("Waiting to be retried")}</h2>
              <span className="chip warn">{pending.length}</span>
            </div>
            <div className="card-body">
              <div className="hint dim" style={{ marginBottom: 10 }}>
                {t(
                  "Calls that failed on every provider. Retrying uses the providers selected in Settings right now - fix anything there first, then retry.",
                )}
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
                      {p.stage === "transcription" ? t("Recording") : t("Transcript")} ·{" "}
                      <span className="stamp">{p.created_at}</span> · {t("{s}s", { s: p.seconds.toFixed(1) })}
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
                      {retryBusy === p.id ? t("Retrying…") : t("Retry")}
                    </button>
                    <button
                      className="btn ghost sm"
                      disabled={retryBusy === p.id}
                      onClick={() => void api.discardPending(p.id)}
                    >
                      {t("Discard")}
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
                {t(state.name)}
              </div>
              <div className="launcher-sub">{t(state.sub)}</div>
            </div>
            <div className={`wave${recording ? " live" : ""}`}>
              {Array.from({ length: 12 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${(i % 6) * 0.09}s` }} />
              ))}
            </div>
          </div>

          {lines.length === 0 ? (
            <div className="card-body first-run">
              <div className="first-run-copy">
                <div className="first-run-title">{t("Make your first line")}</div>
                <div className="hint">
                  {t(
                    "A line is one hotkey plus what it does with your voice - dictation, a note, a checklist, your own instructions. It becomes a button here and a key that works in any app.",
                  )}
                </div>
              </div>
              <button className="btn primary" onClick={onOpenSettings}>
                <Icon name="plus" size={15} />
                {t("Add your first line")}
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
                      t(MODE_LABELS[p.mode].hint) +
                      (p.custom_prompt.trim() ? ` · ${t("custom instructions")}` : "") +
                      ` · ${t(OUTPUT_LABELS[p.output])}`
                    }
                    onClick={() => {
                      setActiveLine(p.id);
                      void api.toggle(p.id);
                    }}
                  >
                    <span className="line-name">
                      {/* The same glyph the recording pill will show, so the
                          button you press and the pill that appears are
                          obviously the same thing. */}
                      <Icon name={lineIcon(p)} size={14} className="line-ico" />
                      {p.name}
                      {live && <span className="dot rec" />}
                    </span>
                    <Kbd spec={p.hotkey} />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* The figures, as one small dim line instead of four cards. Every
         *  number the stat row carried is still here. */}
        <div className="home-info">
          <span>
            {lines.length === 1 ? t("1 line") : t("{n} lines", { n: lines.length })}
          </span>
          <span>
            {t("{n} today ({d} audio)", {
              n: usage.today_count,
              d: formatDuration(usage.today_audio_seconds),
            })}
          </span>
          <span>
            {t("${cost} this month · {n} results", {
              cost: usage.month_cost.toFixed(4),
              n: usage.month_count,
            })}
            {!usage.cost_complete && ` · ${t("some providers untracked")}`}
          </span>
          <span className="home-chain">
            {t("hear")} <b title={settings.sttModel}>{settings.sttModel}</b> {t("→")}{" "}
            {t("write")}{" "}
            <b title={settings.refineEnabled ? settings.refineModel : t("raw transcript")}>
              {settings.refineEnabled ? settings.refineModel : t("raw transcript")}
            </b>
          </span>
        </div>

        <div className="card">
          <div className="card-head">
            <Icon name="chat" size={17} />
            <h2>{t("Latest result")}</h2>
            {latest && <span className="chip">{t(MODE_LABELS[latest.mode].name)}</span>}
            {latest && (
              <span className="chip nums">
                {t("{s}s", { s: latest.seconds.toFixed(1) })}
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
              {copied ? t("Copied") : t("Copy")}
            </button>
            {/* The recording itself, same as a history row: the wave button
             * puts it on the clipboard as a file, ready for a chat. */}
            <button
              className="btn sm"
              disabled={!latest?.audio_file}
              title={
                latest?.audio_file
                  ? t("Copy the recording as a file")
                  : t("This entry no longer has its recording")
              }
              aria-label={t("Copy the recording as a file")}
              onClick={() => {
                if (!latest) return;
                void api
                  .copyHistoryAudio(latest.id)
                  .then(() => {
                    setCopiedClip(true);
                    setTimeout(() => setCopiedClip(false), 1500);
                  })
                  .catch(() => setCopiedClip(false));
              }}
            >
              <Icon name={copiedClip ? "check" : "wave"} size={15} />
              {copiedClip ? t("Copied") : t("Audio")}
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
                    {latest.stt_via_backup ? ` · ${t("backup")}` : ""}
                    {latest.refine_model ? ` → ${latest.refine_model}` : ` → ${t("raw")}`}
                  </span>
                )}
                {latest.microphone && (
                  <span className="hist-mic">🎙 {latest.microphone}</span>
                )}
              </div>
            )}

            <div className={`result-text${latest ? "" : " empty-text"}`} dir="auto">
              {latest ? latest.refined : t("Your latest result will appear here.")}
            </div>
          </div>
        </div>

        {/* Provider allowance, as one small dim line per provider at the very
         *  bottom. Usage against the day's allowance, rather than the
         *  provider's own "remaining": Groq reports what is free to send *this
         *  instant* and refills one request every 43 seconds - so dictating
         *  any slower than that made it read 1999/2000 forever, no matter how
         *  much the day had actually consumed. The limit is theirs and real;
         *  the running total is ours. The warning bar only earns its space
         *  when the instantaneous figure is close enough to bite. */}
        {liveQuotas.length > 0 && (
          <div className="quota-strip">
            {liveQuotas.map((q) => {
              const req = q.items.find((i) => i.kind === "requests");
              const limit = Number(req?.limit ?? 0);
              const remaining = Number(req?.remaining ?? 0);
              const used = usage.today_count;
              const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
              const tight = limit > 0 && remaining < limit * 0.25;

              return (
                <div
                  className={`quota-line${tight ? " tight" : ""}`}
                  key={q.host}
                  title={
                    limit > 0
                      ? t(
                          "{pct}% of today's allowance · {left} left right now · back to full in {reset}",
                          { pct: pct.toFixed(1), left: remaining, reset: req?.reset ?? "" },
                        )
                      : undefined
                  }
                >
                  <Icon name="bolt" size={12} className="quota-bolt" />
                  <span className="quota-host">{q.host}</span>
                  <span className="quota-sep">·</span>
                  <span>
                    {t("{used} today", { used: limit > 0 ? `${used} / ${limit}` : used })}
                  </span>
                  <span className="quota-sep">·</span>
                  <span>
                    {t("{d} audio", { d: formatDuration(usage.today_audio_seconds) })}
                  </span>
                  {q.at && (
                    <>
                      <span className="quota-sep">·</span>
                      <span>{t("reported {at}", { at: q.at })}</span>
                    </>
                  )}
                  {tight && limit > 0 && (
                    <>
                      <span
                        className="quota-bar"
                        title={t("{pct}% of today's allowance", { pct: pct.toFixed(1) })}
                      >
                        <span style={{ width: `${Math.max(pct, 2)}%` }} />
                      </span>
                      <span className="quota-tight">
                        {t("only {left} left to send right now · back to full in {reset}", {
                          left: remaining,
                          reset: req?.reset ?? "",
                        })}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
