import { useEffect, useRef } from "react";
import type { OverlayStyle } from "../lib/api";

/**
 * The Settings page's live miniature of the recording pill.
 *
 * It runs on a simulated voice - a syllable envelope with pauses - so the
 * colours, the glow and the wave shape can be judged without dictating, and it
 * mirrors the real overlay's glow composition exactly: two independent parts,
 * the inner one lighting the pill's own edges and the outer one casting light
 * around it.
 */

export function hexRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [47, 214, 165];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function isLightBg(hex: string): boolean {
  const [r, g, b] = hexRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

/** A live miniature of the pill with the chosen look, driven by a simulated
 *  voice so colors and shapes can be judged without dictating. Mirrors the
 *  glow composition the real overlay uses: two independent parts. */
export default function PillPreview({
  style,
  glowInner,
  glowOuter,
  auraColor,
  bg,
}: {
  style: OverlayStyle;
  glowInner: boolean;
  glowOuter: boolean;
  auraColor: string;
  bg: string;
}) {
  const pill = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const fill = useRef<HTMLElement | null>(null);
  const ring = useRef<HTMLElement | null>(null);
  const wave = useRef<HTMLSpanElement | null>(null);
  const peak = useRef(0.02);
  const hist = useRef<number[]>([]);
  const phase = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      phase.current += dt;
      // A speech-like envelope: syllable bursts with pauses.
      const syl = 0.55 + 0.45 * Math.sin(phase.current * 2 * Math.PI * 3.6);
      const phrase = (Math.sin(phase.current * 0.9) + Math.sin(phase.current * 0.23)) / 2;
      const talking = phrase > -0.25;
      const level = talking ? 0.012 + 0.09 * Math.max(0, syl) * (0.8 + 0.2 * phrase) : 0.0015;
      peak.current = Math.max(level, peak.current * 0.995);
      const db = 20 * Math.log10(Math.max(level, 1e-5));
      const dbN = Math.min(1, Math.max(0.04, (db + 58) / 40));
      const agc = Math.min(1, Math.max(0.04, (level / Math.max(peak.current, 0.018)) * 0.88));
      const v = Math.min(1, Math.max(0.04, agc * 0.65 + dbN * 0.35));
      const silent = !talking;

      const el = pill.current;
      if (el) {
        const m = /^#?([0-9a-f]{6})$/i.exec(auraColor.trim());
        const n = m ? parseInt(m[1], 16) : 0x2fd6a5;
        const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
        if (!glowInner && !glowOuter) {
          el.style.borderColor = "#2b3341";
          el.style.boxShadow = "none";
        } else {
          const outer = glowOuter
            ? `0 0 ${(5 + v * 12) * 1.3}px rgba(${r},${g},${b},${0.14 + v * 0.42}),` +
              `0 0 ${(13 + v * 30) * 1.3}px rgba(${r},${g},${b},${0.08 + v * 0.34})`
            : "";
          const inner = glowInner
            ? `${outer ? "," : ""}inset 0 0 ${(2 + v * 15) * 1.3}px rgba(${r},${g},${b},${0.07 + v * 0.26})`
            : "";
          el.style.borderColor = glowOuter
            ? `rgba(${r},${g},${b},${0.28 + v * 0.6})`
            : "#2b3341";
          el.style.boxShadow = `${outer}${inner}` || "none";
        }
      }

      const color = silent ? "#e5b062" : auraColor;
      if (wave.current) {
        wave.current.querySelectorAll<HTMLElement>("i").forEach((bar, i, all) => {
          const t = (phase.current * 0.62 + i / all.length) % 1;
          const h = talking ? Math.max(2.4, Math.abs(Math.sin(t * Math.PI * 3)) * v * 24) : 2.4;
          bar.style.height = `${h}px`;
          bar.style.background = color;
        });
      }
      const c = canvas.current;
      if (c) {
        const ctx = c.getContext("2d");
        if (ctx) {
          if (!c.width) {
            const dpr = 2;
            c.width = Math.max(1, c.clientWidth) * dpr;
            c.height = Math.max(1, c.clientHeight) * dpr;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
          const w = c.clientWidth, h = c.clientHeight, mid = h / 2;
          ctx.clearRect(0, 0, w, h);
          if (style === "ribbon") {
            hist.current.push(v);
            if (hist.current.length > 62) hist.current.shift();
          } else {
            hist.current.push(talking && level > 0.01 ? Math.max(0.12, v) : 0);
            if (hist.current.length > 62) hist.current.shift();
          }
          const vals = hist.current;
          if (vals.length > 2) {
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
      }
      if (fill.current) {
        fill.current.style.width = `${v * 100}%`;
        fill.current.style.background = `linear-gradient(90deg, ${color} 0%, ${color} 62%, #e5b062 84%, #ef6b6b 97%)`;
      }
      if (ring.current) {
        const d = 10 + v * 28;
        ring.current.style.width = `${d}px`;
        ring.current.style.height = `${d}px`;
        ring.current.style.opacity = `${0.2 + v * 0.7}`;
        ring.current.style.borderColor = color;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [style, glowInner, glowOuter, auraColor, bg]);

  const resetCanvas = (el: HTMLCanvasElement | null) => {
    canvas.current = el;
    if (el) el.width = 0;
  };

  return (
    <div className="pill-preview">
      <div className="overlay-pill" ref={pill} style={{ background: bg }}>
        {style === "ring" ? (
          <span className="overlay-ringbox">
            <span className="overlay-dot" />
            <i className="overlay-ring" ref={ring} />
          </span>
        ) : (
          <span className="overlay-dot" />
        )}
        {style === "bars" && (
          <span className="overlay-wave" ref={wave}>
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} />
            ))}
          </span>
        )}
        {(style === "ribbon" || style === "blobs") && <canvas className="overlay-canvas" ref={resetCanvas} />}
        {style === "meter" && (
          <span className="overlay-meter">
            <i ref={fill} />
          </span>
        )}
        <span
          className="overlay-timer"
          style={isLightBg(bg) ? { color: "#4a5563" } : undefined}
        >
          0:07
        </span>
      </div>
    </div>
  );
}
