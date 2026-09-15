import { useEffect, useRef, useState } from "react";
import { api, type OverlayStyle, type Status } from "../lib/api";

const BARS = 16;

interface PillCfg {
  style: OverlayStyle;
  glowInner: boolean;
  glowOuter: boolean;
  auraColor: string;
  bg: string;
}

function clock(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const clampLow = (v: number) => Math.min(1, Math.max(0.04, v));
const dbNorm = (l: number) => {
  const db = 20 * Math.log10(Math.max(l, 1e-5));
  return clampLow((db + 58) / 40);
};

function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [47, 214, 165];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Light backgrounds need dark secondary text for the timer to read. */
function isLightBg(hex: string): boolean {
  const [r, g, b] = hexRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

/**
 * The small capture pill that hovers just above the taskbar while the mic is
 * live. Everything about it - wave shape, the two glow parts, colors - is the
 * user's, read fresh from settings on every poll into a ref, because the
 * poll closure lives for the page's lifetime and must never draw from a
 * stale render. The glow's inner part lights the pill's own edges, the outer
 * part casts light around it, and each can be off on its own.
 */
export default function Overlay() {
  const [status, setStatus] = useState<Status>("idle");
  const cfg = useRef<PillCfg>({
    style: "bars",
    glowInner: true,
    glowOuter: true,
    auraColor: "#2fd6a5",
    bg: "#12161d",
  });
  const [, setTick] = useState(0);
  const [showLabel, setShowLabel] = useState("");
  const [secs, setSecs] = useState(0);
  const pillRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterFill = useRef<HTMLElement | null>(null);
  const meterPeak = useRef<HTMLElement | null>(null);
  const ringRef = useRef<HTMLElement | null>(null);
  const ringLag = useRef<HTMLElement | null>(null);
  const bars = useRef<number[]>(new Array(BARS).fill(0.05));
  const hist = useRef<number[]>([]);
  const blobs = useRef<number[]>([]);
  const waveLag = useRef<number[]>([]);
  const peak = useRef(0.02);
  const meterPk = useRef(0);
  const lastSound = useRef<number>(Date.now());
  const lastLook = useRef("");

  useEffect(() => {
    void api.overlayState().then((s) => {
      setStatus(s.status);
      void api.overlayAlive(s.status);
    });
  }, []);

  // Proof of life, for Rust's side of the bargain. A requestAnimationFrame
  // tick only happens while this window is actually being composited, so a
  // pill whose surface has stopped being drawn stops sending these - and the
  // app repairs the window instead of leaving an invisible pill that needs a
  // restart. Sent about twice a second rather than once per frame.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = () => {
      const now = performance.now();
      if (now - last > 500) {
        last = now;
        // Swallowed: the same "the window is shutting down" case the poll
        // ignores, and the dev mock has no handler for it.
        api.overlayFrame().catch(() => {});
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await api.overlayState();
        if (cancelled) return;
        setStatus((prev) => {
          if (s.status === "recording" && prev !== "recording") {
            setSecs(0);
            lastSound.current = Date.now();
            bars.current.fill(0.05);
            hist.current = [];
            blobs.current = [];
            waveLag.current = [];
          }
          return s.status;
        });
        setShowLabel(s.status === "transcribing" ? "Transcribing…" : s.status === "refining" ? "Refining…" : "");
        const look = `${s.style}|${s.glow_inner}|${s.glow_outer}|${s.aura_color}|${s.bg}`;
        if (look !== lastLook.current) {
          lastLook.current = look;
          cfg.current = {
            style: s.style,
            glowInner: s.glow_inner,
            glowOuter: s.glow_outer,
            auraColor: s.aura_color,
            bg: s.bg,
          };
          setTick((x) => x + 1);
        }
        if (s.level > 0.006) lastSound.current = Date.now();
        const silent = Date.now() - lastSound.current > 1200;
        drawWave(s.status, s.level, silent);
      } catch {
        /* the window is shutting down; stop caring */
      }
    };
    const t = setInterval(() => void poll(), 40);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Separate 1s tick: the timer itself advances even in pure silence.
  useEffect(() => {
    const t = setInterval(() => {
      setSecs((s) => s + 1);
      setTick((x) => x + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /** One sensitivity read: decibel floor plus auto-gain, so a whisper and a
   *  shout both use the full wave without clipping. */
  function sens(level: number): number {
    peak.current = Math.max(level, peak.current * 0.996);
    const agc = clampLow((level / Math.max(peak.current, 0.018)) * 0.88);
    return Math.min(1, Math.max(0.04, agc * 0.65 + dbNorm(level) * 0.35));
  }

  /** Composes the two independent glow parts. The border tint belongs to the
   *  outer glow; with outer off the pill keeps its quiet default edge. */
  function glow(pill: HTMLDivElement, s: number) {
    const { glowInner, glowOuter, auraColor } = cfg.current;
    const [r, g, b] = hexRgb(auraColor);
    if (!glowInner && !glowOuter) {
      pill.style.borderColor = "#2b3341";
      pill.style.boxShadow = "none";
      return;
    }
    const outer =
      glowOuter
        ? `0 0 ${(5 + s * 12) * 1.3}px rgba(${r},${g},${b},${0.14 + s * 0.42}),` +
          `0 0 ${(13 + s * 30) * 1.3}px rgba(${r},${g},${b},${0.08 + s * 0.34})`
        : "";
    const inner = glowInner
      ? `${outer ? "," : ""}inset 0 0 ${(2 + s * 15) * 1.3}px rgba(${r},${g},${b},${0.07 + s * 0.26})`
      : "";
    pill.style.borderColor = glowOuter
      ? `rgba(${r},${g},${b},${0.28 + s * 0.6})`
      : "#2b3341";
    pill.style.boxShadow = `${outer}${inner}` || "none";
  }

  function drawWave(status: Status, level: number, silent: boolean) {
    const pill = pillRef.current;
    if (!pill) return;
    const { style, auraColor } = cfg.current;
    const dot = pill.querySelector<HTMLElement>(".overlay-dot");
    if (dot) dot.classList.toggle("warn", status !== "recording" || silent);
    glow(pill, status === "recording" ? sens(level) : 0.04);
    if (status !== "recording") return;

    const v = sens(level);
    const color = silent ? "#e5b062" : auraColor;

    if (style === "bars") {
      bars.current.push(v);
      bars.current.shift();
      pill.querySelectorAll<HTMLElement>(".overlay-wave i").forEach((b, i) => {
        b.style.background = color;
        b.style.height = `${Math.max(2.4, bars.current[i] * 24)}px`;
      });
    } else if (style === "meter") {
      meterPk.current = Math.max(v, meterPk.current - 0.006);
      if (meterFill.current) {
        meterFill.current.style.width = `${v * 100}%`;
        meterFill.current.style.background = `linear-gradient(90deg, ${color} 0%, ${color} 62%, #e5b062 84%, #ef6b6b 97%)`;
      }
      if (meterPeak.current) meterPeak.current.style.left = `calc(${Math.min(meterPk.current, 1) * 100}% - 1px)`;
    } else if (style === "ring") {
      waveLag.current.push(v);
      if (waveLag.current.length > 8) waveLag.current.shift();
      const lag = waveLag.current[0] ?? 0;
      const set = (el: HTMLElement | null, d: number, o: number) => {
        if (!el) return;
        el.style.width = `${d}px`;
        el.style.height = `${d}px`;
        el.style.opacity = `${o}`;
        el.style.borderColor = color;
      };
      set(ringRef.current, 10 + v * 28, 0.2 + v * 0.7);
      set(ringLag.current, 10 + lag * 28, 0.06 + lag * 0.32);
    } else {
      // ribbon and blobs share one canvas that fills the pill's middle.
      const c = canvasRef.current;
      if (!c) return;
      if (style === "ribbon") {
        hist.current.push(v);
        if (hist.current.length > 62) hist.current.shift();
      } else {
        blobs.current.push(level > 0.01 ? Math.max(0.12, v) : 0);
        if (blobs.current.length > 62) blobs.current.shift();
      }
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const w = c.clientWidth, h = c.clientHeight, mid = h / 2;
      ctx.clearRect(0, 0, w, h);
      const vals = style === "ribbon" ? hist.current : blobs.current;
      if (vals.length < 2) return;
      const step = w / 62;
      const x0 = w - vals.length * step;
      if (style === "ribbon") {
        const y = (val: number) => 2 + val * (mid - 3);
        const yT = (val: number) => mid - (y(val) - mid);
        ctx.beginPath();
        ctx.moveTo(x0, yT(vals[0]));
        for (let i = 1; i < vals.length; i++) {
          const xa = x0 + (i - 1) * step, xb = x0 + i * step;
          ctx.quadraticCurveTo(xa, yT(vals[i - 1]), (xa + xb) / 2, (yT(vals[i - 1]) + yT(vals[i])) / 2);
        }
        for (let i = vals.length - 1; i >= 0; i--) {
          const xa = x0 + i * step, xb = x0 + (i + 1) * step;
          const prev = i > 0 ? vals[i - 1] : vals[i];
          ctx.quadraticCurveTo(xa, y(vals[i]), (xa + xb) / 2, (y(vals[i]) + y(prev)) / 2);
        }
        ctx.closePath();
        ctx.globalAlpha = silent ? 0.55 : 1;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = color;
        vals.forEach((b, i) => {
          if (b <= 0) return;
          const bh = 4 + b * (h - 8);
          ctx.globalAlpha = silent ? 0.5 : 0.35 + b * 0.65;
          ctx.beginPath();
          ctx.roundRect(x0 + i * step, mid - bh / 2, Math.max(2, step - 1), bh, 1.5);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }
    }
  }

  function sizeCanvas(c: HTMLCanvasElement | null) {
    if (!c) return;
    const dpr = 2;
    c.width = Math.max(1, c.clientWidth) * dpr;
    c.height = Math.max(1, c.clientHeight) * dpr;
    c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // The window itself stays where it is, on screen, for the life of the app:
  // hiding it or parking it off screen suspends or occludes its renderer, and
  // the pill that never comes back from that is exactly the bug this page now
  // helps catch. Idle means the pill is not drawn, nothing more.
  if (status === "idle") return <div className="overlay-root" />;

  const silentTooLong = status === "recording" && Date.now() - lastSound.current > 1200;
  const warn = status !== "recording" || silentTooLong;
  const c = cfg.current;

  return (
    <div className="overlay-root">
      <div className="overlay-pill" ref={pillRef} style={{ background: c.bg }}>
        {c.style === "ring" && status === "recording" ? (
          <span className="overlay-ringbox">
            <span className={`overlay-dot${warn ? " warn" : ""}`} />
            <i className="overlay-ring" ref={ringRef} />
            <i className="overlay-ring lag" ref={ringLag} />
          </span>
        ) : (
          <span className={`overlay-dot${warn ? " warn" : ""}`} />
        )}
        {status === "recording" ? (
          <>
            {c.style === "bars" && (
              <span className="overlay-wave">
                {bars.current.map((_, i) => (
                  <i key={i} />
                ))}
              </span>
            )}
            {(c.style === "ribbon" || c.style === "blobs") && (
              <canvas
                className="overlay-canvas"
                ref={(el) => {
                  canvasRef.current = el;
                  sizeCanvas(el);
                }}
              />
            )}
            {c.style === "meter" && (
              <span className="overlay-meter">
                <i ref={meterFill} />
                <b ref={meterPeak} />
              </span>
            )}
            <span
              className="overlay-timer"
              style={isLightBg(c.bg) ? { color: "#4a5563" } : undefined}
            >
              {clock(secs)}
            </span>
          </>
        ) : (
          <span
            className="overlay-label"
            style={isLightBg(c.bg) ? { color: "#3a434f" } : undefined}
          >
            {showLabel}
          </span>
        )}
      </div>
    </div>
  );
}
