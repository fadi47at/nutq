import { useEffect, useReducer, useRef, useState } from "react";
import { api, type Status } from "../lib/api";

const BARS = 16;
/** RMS of speech sits around 0.01-0.15; stretch it into a visible bar. */
const SCALE = 9;

const LABELS: Record<Status, string> = {
  idle: "",
  recording: "Listening",
  transcribing: "Transcribing…",
  refining: "Refining…",
};

function clock(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The small capture pill that hovers just above the taskbar while the mic is
 * live - the whisper-style "this program is listening" tell. A red pulsing
 * dot and a tiny live waveform say audio is arriving; the dot going amber
 * means the mic has been silent for over a second.
 *
 * Everything is pulled by polling rather than pushed by events: event
 * delivery into this hidden webview proved unreliable, while invoke works
 * perfectly, so the overlay owns its own refresh.
 */
export default function Overlay() {
  const [status, setStatus] = useState<Status>("idle");
  const [secs, setSecs] = useState(0);
  const bars = useRef<number[]>(new Array(BARS).fill(0.05));
  const lastSound = useRef<number>(Date.now());
  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    void api.overlayState().then((s) => {
      setStatus(s.status);
      void api.overlayAlive(s.status);
    });
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
          }
          return s.status;
        });
        const b = bars.current;
        b.push(Math.min(1, Math.max(0.05, s.level * SCALE)));
        b.shift();
        if (s.level > 0.004) lastSound.current = Date.now();
        force();
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

  // Separate 1s tick so the timer and the "went silent" dot advance even
  // while the level itself is pure silence.
  useEffect(() => {
    const t = setInterval(() => {
      setSecs((s) => s + 1);
      force();
    }, 1000);
    return () => clearInterval(t);
  }, []);

  if (status === "idle") return null;

  const silentTooLong = status === "recording" && Date.now() - lastSound.current > 1200;
  const warn = status !== "recording" || silentTooLong;

  return (
    <div className="overlay-root">
      <div className="overlay-pill">
        <span className={`overlay-dot${warn ? " warn" : ""}`} />
        {status === "recording" ? (
          <>
            <span className="overlay-wave">
              {bars.current.map((h, i) => (
                <i key={i} style={{ height: `${Math.max(2, h * 20)}px` }} />
              ))}
            </span>
            <span className="overlay-timer">{clock(secs)}</span>
          </>
        ) : (
          <span className="overlay-label">{LABELS[status]}</span>
        )}
      </div>
    </div>
  );
}
