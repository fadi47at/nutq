import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  events,
  MODE_LABELS,
  type HistoryEntry,
  type UsageBucket,
  type UsageRange,
} from "../lib/api";

/** Entries per page. The whole list is fetched once - it is text and capped at
 *  500 - but rendering it in one scroll made the page unusable at any size. */
const PAGE_SIZE = 10;

/** The chart's range choices. "day" breaks today into its 24 hours; the rest
 *  are trailing windows of whole days ending today. */
const RANGES: { id: UsageRange; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "3 Months" },
];

/**
 * Playback for one entry's kept recording.
 *
 * The wav is fetched only when asked for, as a base64 data URL: audio is
 * orders of magnitude bigger than the text beside it, and a history page that
 * loaded every clip up front would pull tens of megabytes to show a list.
 */
function ClipPlayer({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);

  // Nothing here survives leaving the page, and a data URL costs no handle to
  // release, so the clip is simply dropped with the component.
  useEffect(() => () => audio.current?.pause(), []);

  if (src) {
    return <audio ref={audio} className="hist-audio" src={src} controls autoPlay />;
  }

  return (
    <>
      <button
        className="btn ghost"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError("");
          try {
            setSrc(`data:audio/wav;base64,${await api.getHistoryAudio(id)}`);
          } catch (e) {
            setError(String(e));
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "Loading…" : "▶ Play"}
      </button>
      {error && <span className="hist-audio-error">{error}</span>}
    </>
  );
}

/** An exact duration: every second is accounted for, never rounded away -
 * "2m 18s", not "2m". The chart's whole job is honest numbers. */
function duration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
}

/** Colors handed out per model name. The palette is hand-picked to stay
 *  readable on the dark panels; the hash just picks from it, so a model
 *  keeps the same color across ranges, charts and sessions. */
const MODEL_COLORS = [
  "#4f8fe2", // blue
  "#e2554f", // red
  "#3fa66a", // green
  "#e8b13f", // amber
  "#9a6de0", // violet
  "#e07bb0", // pink
  "#3fb5b0", // teal
  "#8a93a5", // grey
];

function modelColor(model: string): string {
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return MODEL_COLORS[h % MODEL_COLORS.length];
}

/** Gridline ladders per metric: the smallest step whose three lines clear the
 *  busiest bucket, so tick labels stay round ("1m", "5m", "20m") at every
 *  range instead of arbitrary decimals. */
const SEC_STEPS = [
  15, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200, 14400, 28800, 43200,
  86400, 172800, 604800,
];
const COUNT_STEPS = [1, 2, 5, 10, 20, 50, 100, 250, 500, 1000];

function axisStep(max: number, steps: number[]): number {
  for (const s of steps) if (3 * s >= max) return s;
  return steps[steps.length - 1];
}

/** Axis caption for a bucket label: "HH:00" fits as is; dates shrink to
 *  "MM-DD" so ninety of them still fit under the chart. */
function shortLabel(label: string): string {
  return label.length > 5 ? label.slice(5) : label;
}

/**
 * The "Charts" view: the two stacked bar panels rebuilt on one shared SVG
 * time axis, with real gridlines, tick labels, each bar's total written
 * above it and a dashed average line - values are readable straight off the
 * chart, the hover tooltip only adds the per-model split. Zero buckets keep
 * a faint base tick, so a gap still reads as a gap.
 */
function AxisUsageChart({
  stats,
  modelOrder,
  per,
  onHover,
  onLeave,
}: {
  stats: UsageBucket[];
  modelOrder: string[];
  per: string;
  onHover: (i: number, clientX: number, clientY: number) => void;
  onLeave: () => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 880;
  const padL = 46;
  const padR = 16;
  const padB = 26;
  const top = 22;
  const panelH = 128;
  const gap = 54;
  const n = stats.length;
  const band = (W - padL - padR) / n;
  const H = top + panelH * 2 + gap + padB;
  const labelStep = Math.max(1, Math.ceil(n / 9));
  const suffix = per === "per hour" ? "/h" : "/d";

  const panels = [
    {
      title: "Audio",
      metric: "seconds" as const,
      fmt: duration,
      avgFmt: duration,
      step: axisStep(Math.max(...stats.map((b) => b.seconds), 1), SEC_STEPS),
      avg: stats.reduce((a, b) => a + b.seconds, 0) / n,
      unitX: padL + 42,
    },
    {
      title: "Requests",
      metric: "count" as const,
      fmt: (v: number) => `${Math.round(v)}`,
      avgFmt: (v: number) => v.toFixed(1),
      step: axisStep(Math.max(...stats.map((b) => b.count), 1), COUNT_STEPS),
      avg: stats.reduce((a, b) => a + b.count, 0) / n,
      unitX: padL + 70,
    },
  ];

  return (
    <>
      <svg
        className="usage-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Audio and requests, ${per}`}
      >
        {hover !== null && (
          <rect
            x={padL + hover * band}
            y={top - 6}
            width={band}
            height={panelH * 2 + gap + 6}
            fill="rgba(22, 27, 35, 0.05)"
            rx={6}
          />
        )}
        {panels.map((p, idx) => {
          const y0 = top + panelH + idx * (panelH + gap);
          const axisMax = p.step * 3;
          const yv = (v: number) => y0 - (v / axisMax) * panelH;
          const totals = stats.map((b) => b.models.reduce((a, s) => a + s[p.metric], 0));
          const peak = Math.max(...totals);
          return (
            <g key={p.title}>
              <text x={padL} y={y0 - panelH - 8} fontSize={12} fontWeight={600} fill="var(--muted)">
                {p.title}
              </text>
              <text x={p.unitX} y={y0 - panelH - 8} fontSize={10.5} fill="var(--faint)">
                · {per}
              </text>
              {[0, 1, 2, 3].map((t) => (
                <g key={t}>
                  <line
                    x1={padL}
                    x2={W - padR}
                    y1={yv(t * p.step)}
                    y2={yv(t * p.step)}
                    stroke={t === 0 ? "#d6dce4" : "#e8edf3"}
                  />
                  <text x={padL - 8} y={yv(t * p.step) + 4} textAnchor="end" fontSize={10} fill="var(--faint)">
                    {p.fmt(t * p.step)}
                  </text>
                </g>
              ))}
              {stats.map((b, i) => {
                const segs = modelOrder
                  .map((m) => ({ model: m, v: b.models.find((s) => s.model === m)?.[p.metric] ?? 0 }))
                  .filter((s) => s.v > 0);
                const total = totals[i];
                const bw = band * 0.56;
                const x = padL + (i + 0.5) * band - bw / 2;
                let acc = 0;
                return (
                  <g key={b.label}>
                    {total === 0 && (
                      <rect x={x} y={y0 - 2} width={bw} height={2} rx={1} fill="var(--panel-2)" />
                    )}
                    {segs.map((s, si) => {
                      const h = Math.max((s.v / axisMax) * panelH, 1.5);
                      const y = y0 - acc - h;
                      acc += h;
                      return (
                        <rect
                          key={s.model}
                          x={x}
                          y={y}
                          width={bw}
                          height={h}
                          rx={si === segs.length - 1 ? 2.5 : 0}
                          fill={modelColor(s.model)}
                        />
                      );
                    })}
                    {band >= 14 && total > 0 && (
                      <text
                        x={x + bw / 2}
                        y={yv(Math.min(total, axisMax)) - 6}
                        textAnchor="middle"
                        fontSize={9.5}
                        fontWeight={total === peak ? 700 : 400}
                        fill={total === peak ? "var(--text)" : "var(--faint)"}
                      >
                        {p.fmt(total)}
                      </text>
                    )}
                  </g>
                );
              })}
              <line
                x1={padL}
                x2={W - padR}
                y1={yv(p.avg)}
                y2={yv(p.avg)}
                stroke="var(--text)"
                strokeOpacity={0.35}
                strokeDasharray="3 4"
              />
              {/* Left-anchored: the right edge is where the newest, usually
                  tallest bar lives, so an average tag there always collides. */}
              <text x={padL + 8} y={yv(p.avg) - 5} fontSize={9.5} fill="var(--faint)">
                avg {p.avgFmt(p.avg)}
                {suffix}
              </text>
            </g>
          );
        })}
        {stats.map((b, i) =>
          i % labelStep === 0 ? (
            <text
              key={b.label}
              x={padL + (i + 0.5) * band}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--faint)"
            >
              {shortLabel(b.label)}
            </text>
          ) : null
        )}
        <rect
          x={padL}
          y={top - 6}
          width={W - padL - padR}
          height={panelH * 2 + gap + 6}
          fill="transparent"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.max(0, Math.min(n - 1, Math.floor((px - padL) / band)));
            setHover(i);
            onHover(i, e.clientX, e.clientY);
          }}
          onMouseLeave={() => {
            setHover(null);
            onLeave();
          }}
        />
      </svg>
      <div className="chart-legend">
        {modelOrder.map((m) => (
          <span className="chart-key" key={m} title={m}>
            <i style={{ background: modelColor(m) }} />
            {m}
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * The "Analysis" view: two aligned heat strips (audio, then requests, bucket
 * by bucket), the per-model table with each model's share, and a few notes
 * computed straight from the buckets - the reading the bars leave to
 * guesswork. Shares reuse the same model colors as the bars, so a color
 * means the same model in both views.
 */
function UsageLedger({
  stats,
  modelOrder,
  per,
  isDay,
  totalSeconds,
  totalCount,
  onHover,
  onLeave,
}: {
  stats: UsageBucket[];
  modelOrder: string[];
  per: string;
  isDay: boolean;
  totalSeconds: number;
  totalCount: number;
  onHover: (i: number, clientX: number, clientY: number) => void;
  onLeave: () => void;
}) {
  const n = stats.length;
  const maxSec = Math.max(...stats.map((b) => b.seconds), 1);
  const maxCnt = Math.max(...stats.map((b) => b.count), 1);
  const labelStep = Math.max(1, Math.ceil(n / 9));

  // Busiest model first, the reverse of the bars' stacking order.
  const rows = modelOrder
    .slice()
    .reverse()
    .map((model) => ({
      model,
      seconds: stats.reduce((a, b) => a + (b.models.find((s) => s.model === model)?.seconds ?? 0), 0),
      count: stats.reduce((a, b) => a + (b.models.find((s) => s.model === model)?.count ?? 0), 0),
    }));

  const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0) + "%";
  const heat = (v: number, max: number, rgb: string) =>
    v <= 0 ? "var(--panel-2)" : `rgba(${rgb},${(0.14 + 0.86 * Math.sqrt(v / max)).toFixed(3)})`;

  // The busiest stretch: a sliding window of about a sixth of the range,
  // which on Day lands on the midday cluster and on Month on the busiest
  // run of days.
  const winLen = Math.max(1, Math.round(n / 6));
  let winStart = 0;
  let winSum = 0;
  for (let s = 0; s + winLen <= n; s++) {
    let sum = 0;
    for (let j = s; j < s + winLen; j++) sum += stats[j].seconds;
    if (sum > winSum) {
      winSum = sum;
      winStart = s;
    }
  }
  const winA = shortLabel(stats[winStart].label);
  const winEnd =
    winStart + winLen < n ? shortLabel(stats[winStart + winLen].label) : shortLabel(stats[n - 1].label);
  const peakIdx = stats.reduce((best, b, i) => (b.seconds > stats[best].seconds ? i : best), 0);
  const idle = stats.filter((b) => b.count === 0).length;
  const unit = isDay ? "hours" : "days";

  return (
    <div>
      <div className="ledger-label">
        Audio <span>· {per}</span>
      </div>
      <div className="ledger-strip" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {stats.map((b, i) => (
          <div
            key={b.label}
            className="ledger-cell"
            style={{ background: heat(b.seconds, maxSec, "15, 157, 118") }}
            onMouseMove={(e) => onHover(i, e.clientX, e.clientY)}
            onMouseLeave={onLeave}
          />
        ))}
      </div>
      <div className="ledger-label">
        Requests <span>· {per}</span>
      </div>
      <div className="ledger-strip" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {stats.map((b, i) => (
          <div
            key={b.label}
            className="ledger-cell mini"
            style={{ background: heat(b.count, maxCnt, "79, 143, 226") }}
            onMouseMove={(e) => onHover(i, e.clientX, e.clientY)}
            onMouseLeave={onLeave}
          />
        ))}
      </div>
      <div className="ledger-hours" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {stats.map((b, i) => (
          <span key={b.label}>{i % labelStep === 0 ? shortLabel(b.label) : ""}</span>
        ))}
      </div>

      <div className="ledger-table-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Requests</th>
              <th>Audio</th>
              <th>Share of audio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model}>
                <td>
                  <span className="ledger-model">
                    <i style={{ background: modelColor(r.model) }} />
                    {r.model}
                  </span>
                </td>
                <td>
                  {r.count} <em>{pct(r.count, totalCount)}</em>
                </td>
                <td>
                  {duration(r.seconds)} <em>{pct(r.seconds, totalSeconds)}</em>
                </td>
                <td>
                  <div className="ledger-share">
                    <span style={{ width: pct(r.seconds, totalSeconds), background: modelColor(r.model) }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="usage-reads">
        <li>
          Peak <b>{stats[peakIdx].label}</b>: {duration(stats[peakIdx].seconds)} of audio across{" "}
          <b>{stats[peakIdx].count} requests</b>.
        </li>
        <li>
          <b>{duration(winSum)}</b> {winLen === 1 ? `at ${winA}` : `between ${winA} and ${winEnd}`},{" "}
          {pct(winSum, totalSeconds)} of everything.
        </li>
        {rows.length > 0 && (
          <li>
            <b>{rows[0].model}</b> carried {pct(rows[0].count, totalCount)} of requests
            {/* "The remaining" is only true with two models; three or more
                make it a lie about the third's share. */}
            {rows.length === 2 && rows[1].count > 0 ? (
              <>
                ; <b>{rows[1].model}</b> the remaining {pct(rows[1].count, totalCount)}
              </>
            ) : null}
            .
          </li>
        )}
        <li>
          <b>
            {idle} of {n} {unit}
          </b>{" "}
          had no activity.
        </li>
      </ul>
    </div>
  );
}

export default function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState<UsageBucket[]>([]);
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  /** The id whose Delete button is in its confirm step, if any. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  /** The id whose Regenerate call is in flight, if any. */
  const [regenId, setRegenId] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  /** Which face of the usage card is showing: the axis charts or the
   *  analysis breakdown behind them. */
  const [view, setView] = useState<"charts" | "analysis">("charts");
  const cardRef = useRef<HTMLDivElement>(null);
  /** The bucket the hover tooltip is currently reading, plus its position in
   *  card coordinates. Both views feed the same tooltip. */
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);

  // Pulled on a timer, the same deal as the Home page: dictations finish
  // while this window shows something else (the hotkey works from any app),
  // and result events do not reliably reach this webview - so the page
  // re-reads the local history every two seconds and a finished dictation
  // appears here on its own, without leaving or reloading the page. When a
  // result event does make it across, the refresh is immediate instead of
  // waiting for the next tick.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      const [e, s] = await Promise.all([api.getHistory(), api.getHistoryStats(range.id)]);
      if (!alive) return;
      setEntries(e);
      setStats(s);
    };
    void pull();
    const t = setInterval(() => void pull(), 2000);
    const unlisten = events.onResult(() => void pull());
    return () => {
      alive = false;
      clearInterval(t);
      void unlisten.then((un) => un());
    };
  }, [range]);

  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  // Deleting entries shrinks the list; a page past the end must follow it.
  useEffect(() => {
    setPage((p) => Math.min(p, pageCount));
  }, [pageCount]);
  const slice = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // What the selected range totals to, exact to the second.
  const totalSeconds = stats.reduce((a, b) => a + b.seconds, 0);
  const totalCount = stats.reduce((a, b) => a + b.count, 0);
  const per = range.id === "day" ? "per hour" : "per day";

  // The tooltip is clamped into the card: near the right edge it flips to the
  // cursor's left, and it never starts above the card's top.
  const showBucket = (i: number, clientX: number, clientY: number) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTip({
      i,
      x: Math.min(Math.max(10, clientX - r.left + 14), Math.max(10, r.width - 258)),
      y: Math.min(Math.max(10, clientY - r.top + 16), Math.max(10, r.height - 130)),
    });
  };
  const hideBucket = () => setTip(null);

  // One fixed model order for both views, busiest model last so it sits at
  // the base of every stacked bar. Count drives the order: every entry is
  // one request whichever view counts it in.
  const modelOrder = useMemo(() => {
    const totals = new Map<string, number>();
    for (const b of stats) {
      for (const s of b.models) totals.set(s.model, (totals.get(s.model) ?? 0) + s.count);
    }
    return [...totals.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
  }, [stats]);

  async function deleteEntry(id: string) {
    await api.deleteHistoryEntry(id);
    setEntries((es) => es.filter((e) => e.id !== id));
    setStats(await api.getHistoryStats(range.id));
    setConfirmDelete(null);
  }

  // Asks the current refinement provider for a new pass over the entry's
  // saved raw transcript. The backend updates the entry in place and hands
  // it back, so the row reflects the new text immediately instead of
  // waiting for the next poll tick; on failure the entry is untouched and
  // the reason lands in the banner above the list.
  async function regenerate(id: string) {
    setRegenId(id);
    setRegenError(null);
    try {
      const updated = await api.regenerateHistoryEntry(id);
      setEntries((es) => es.map((e) => (e.id === id ? updated : e)));
      setStats(await api.getHistoryStats(range.id));
    } catch (e) {
      setRegenError(String(e));
    } finally {
      setRegenId(null);
    }
  }

  async function clearAll() {
    await api.clearHistory();
    setEntries([]);
    setStats(await api.getHistoryStats(range.id));
    setConfirmClear(false);
    setPage(1);
  }

  // Escape dismisses the clear dialog, same as clicking the backdrop.
  useEffect(() => {
    if (!confirmClear) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmClear(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmClear]);

  return (
    <>
      <div className="eyebrow">Archive</div>
      <h1>History</h1>
      <p className="lede">
        The last 500 results, kept on this machine only, ten per page. Recordings
        are kept for the most recent 100 of them, so older entries keep their
        text but lose their audio.
      </p>

      {regenError && (
        <div className="diag bad" style={{ marginBottom: 10 }}>
          <div className="diag-detail" style={{ whiteSpace: "pre-wrap" }}>
            {regenError}
          </div>
          <div className="row" style={{ flex: "none" }}>
            <button className="btn ghost" onClick={() => setRegenError(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {entries.length > 0 && stats.length > 0 && (
        <div className="usage-card" ref={cardRef}>
          <div className="usage-head">
            <div>
              <div className="usage-title">Usage</div>
              <div className="usage-totals">
                {duration(totalSeconds)} of audio · {totalCount} requests
              </div>
            </div>
            <div className="usage-controls">
              <div className="segmented small">
                <button className={view === "charts" ? "on" : ""} onClick={() => setView("charts")}>
                  Charts
                </button>
                <button className={view === "analysis" ? "on" : ""} onClick={() => setView("analysis")}>
                  Analysis
                </button>
              </div>
              <div className="segmented small">
                {RANGES.map((r) => (
                  <button key={r.id} className={range === r ? "on" : ""} onClick={() => setRange(r)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {view === "charts" ? (
            <AxisUsageChart
              stats={stats}
              modelOrder={modelOrder}
              per={per}
              onHover={showBucket}
              onLeave={hideBucket}
            />
          ) : (
            <UsageLedger
              stats={stats}
              modelOrder={modelOrder}
              per={per}
              isDay={range.id === "day"}
              totalSeconds={totalSeconds}
              totalCount={totalCount}
              onHover={showBucket}
              onLeave={hideBucket}
            />
          )}
          {tip && (
            <div className="usage-tip" style={{ left: tip.x, top: tip.y }}>
              <b>{stats[tip.i].label}</b>
              <span className="tip-total">
                {duration(stats[tip.i].seconds)} of audio · {stats[tip.i].count} requests
              </span>
              {modelOrder
                .filter((m) => {
                  const s = stats[tip.i].models.find((x) => x.model === m);
                  return s !== undefined && (s.seconds > 0 || s.count > 0);
                })
                .map((m) => {
                  const s = stats[tip.i].models.find((x) => x.model === m)!;
                  return (
                    <span className="tip-row" key={m}>
                      <i style={{ background: modelColor(m) }} />
                      {m} · {duration(s.seconds)} · {s.count} req
                    </span>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {entries.length > 0 && (
        <div className="row" style={{ marginBottom: 18 }}>
          <button className="btn ghost" onClick={() => setConfirmClear(true)}>
            Clear history
          </button>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="empty-state">Nothing here yet. Press your hotkey and say something.</div>
      ) : (
        <>
          {slice.map((e) => (
            <div className="hist" key={e.id}>
              <div className="hist-meta">
                <span className="pill">{MODE_LABELS[e.mode].name}</span>
                <span>{e.at}</span>
                <span>· {e.seconds.toFixed(1)}s</span>
                <span>· ${e.cost_usd.toFixed(5)}</span>
                {e.stt_model && (
                  <span className="hist-models">
                    {e.stt_model}
                    {e.stt_via_backup ? " · backup" : ""}
                    {e.refine_model
                      ? ` → ${e.refine_model}${e.refine_via_backup ? " · backup" : ""}`
                      : " → raw"}
                  </span>
                )}
                <div className="spacer" />
                <button
                  className="btn ghost"
                  onClick={() => setShowRaw((s) => ({ ...s, [e.id]: !s[e.id] }))}
                >
                  {showRaw[e.id] ? "Show refined" : "Show raw"}
                </button>
                <button className="btn ghost" onClick={() => void api.copyText(e.refined)}>
                  Copy
                </button>
                <button
                  className="btn ghost"
                  disabled={regenId !== null}
                  onClick={() => void regenerate(e.id)}
                >
                  {regenId === e.id ? "Regenerating…" : "Regenerate"}
                </button>
                {confirmDelete === e.id ? (
                  <>
                    <button className="btn danger" onClick={() => void deleteEntry(e.id)}>
                      Delete this entry
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn ghost" onClick={() => setConfirmDelete(e.id)}>
                    Delete
                  </button>
                )}
              </div>

              {/* Where the audio came from, and the audio itself. Entries
               * recorded before either was tracked simply show neither. */}
              {(e.microphone || e.audio_file) && (
                <div className="hist-source">
                  {e.microphone && (
                    <span className="hist-mic" title={`Recorded from ${e.microphone}`}>
                      🎙 {e.microphone}
                    </span>
                  )}
                  {e.audio_file && <ClipPlayer id={e.id} />}
                </div>
              )}

              <div className="hist-text" dir="auto">
                {showRaw[e.id] ? e.raw : e.refined}
              </div>
            </div>
          ))}

          <div className="pager">
            <button
              className="btn ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Newer
            </button>
            <span className="pager-info">
              Page {page} of {pageCount} · {entries.length} entries
            </span>
            <button
              className="btn ghost"
              disabled={page >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Older ›
            </button>
          </div>
        </>
      )}

      {/* Clearing is irreversible and one click deep, so it asks first in a
       * dialog that cannot be missed or clicked through by accident. */}
      {confirmClear && (
        <div className="modal-backdrop" onClick={() => setConfirmClear(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">Clear all history?</div>
            <p className="modal-text">
              All {entries.length} entries and their recordings will be deleted
              permanently, along with the usage chart's data for those days.
              This cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button className="btn danger" onClick={() => void clearAll()}>
                Delete everything
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
