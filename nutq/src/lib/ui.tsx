/**
 * The shared pieces every page is built from.
 *
 * Three rules keep the app looking like one program instead of six:
 * every page opens with a `PageHead`, every hotkey is drawn by `Kbd` rather
 * than written as prose, and every glyph comes from `Icon` - one stroke
 * weight, one 20px grid, one source of truth.
 */

import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "./api";
import { prettyHotkey } from "./hotkeys";

/**
 * Paint the window in the chosen theme.
 *
 * The stylesheet keys off `data-theme` on <html>, so that attribute is the
 * whole switch for the page. Settings calls this with the *draft* theme, which
 * is what makes picking one show it immediately instead of after a save.
 *
 * The title bar is Windows', not ours, and it takes its colour from the
 * window's own theme - so that is set too, or the app ends up light with a
 * black bar on top of it. "system" passes null, which hands the window back to
 * Windows: anything else pins it, and a pinned window theme is also what the
 * webview reports as `prefers-color-scheme`, so pinning it while following it
 * would be a loop.
 */
export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  try {
    void getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => {});
  } catch {
    /* a plain browser (npm run dev) has no window to theme */
  }
}

/* ------------------------------------------------------------------ icons */

/** Every glyph in the app, drawn on a 20x20 grid at 1.7 stroke. */
const PATHS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3.6 10.1 10 4.4l6.4 5.7" />
      <path d="M5.4 9.2v7.2h9.2V9.2" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.3" />
      <path d="M10 6.7V10l2.4 1.6" />
    </>
  ),
  checklist: (
    <>
      <rect x="3.4" y="4" width="13.2" height="12.6" rx="1.6" />
      <path d="m6.4 8.2 1.5 1.5 2.5-2.7M6.4 12.6l1.5 1.5 2.5-2.7M12.4 8.9h3.4M12.4 13.3h3.4" />
    </>
  ),
  note: (
    <>
      <path d="M5.4 3.8h7.2l3 3v9.4h-10.2z" />
      <path d="M12.4 3.8v3.2h3.2M7.6 10h4.8M7.6 12.8h4.8" />
    </>
  ),
  sliders: (
    <>
      <path d="M4.2 6.2h11.6M4.2 10h11.6M4.2 13.8h11.6" />
      <circle cx="8" cy="6.2" r="1.7" />
      <circle cx="12.6" cy="10" r="1.7" />
      <circle cx="7.2" cy="13.8" r="1.7" />
    </>
  ),
  logs: (
    <>
      <rect x="4.6" y="3.6" width="10.8" height="12.8" rx="1.6" />
      <path d="M7.4 7.4h5.2M7.4 10h5.2M7.4 12.6h3.2" />
    </>
  ),
  mic: (
    <>
      <rect x="7.6" y="3" width="4.8" height="9" rx="2.4" />
      <path d="M4.8 9.6a5.2 5.2 0 0 0 10.4 0M10 14.8V17" />
    </>
  ),
  wave: (
    <>
      <path d="M3.4 10h1.4M7 6.6v6.8M10 4.4v11.2M13 7.4v5.2M15.8 9.2v1.6" />
    </>
  ),
  key: (
    <>
      <circle cx="6.8" cy="9.4" r="3.2" />
      <path d="M9.6 10.6h6.8v2.6M13.6 10.6v2.2" />
    </>
  ),
  chat: (
    <>
      <path d="M16.4 11.4a2.4 2.4 0 0 1-2.4 2.4H7.2L4 16.2V5.8a2.4 2.4 0 0 1 2.4-2.4h7.6a2.4 2.4 0 0 1 2.4 2.4z" />
    </>
  ),
  book: (
    <>
      <path d="M4 4.6h4.2A1.8 1.8 0 0 1 10 6.4v9a1.4 1.4 0 0 0-1.4-1.4H4z" />
      <path d="M16 4.6h-4.2A1.8 1.8 0 0 0 10 6.4v9a1.4 1.4 0 0 1 1.4-1.4H16z" />
    </>
  ),
  palette: (
    <>
      <path d="M10 16.4a6.4 6.4 0 1 1 6.4-6.4c0 1.6-1.2 2.4-2.6 2.4h-1.2a1.6 1.6 0 0 0-1.1 2.7 1.1 1.1 0 0 1-.8 1.9z" />
      <circle cx="7" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="6.4" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13.4" cy="8.4" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="7.2" y="7.2" width="8.4" height="8.4" rx="1.8" />
      <path d="M12.6 4.4h-8v8.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.6 6.2h10.8M8.2 6.2V4.8h3.6v1.4M6.2 6.2l.7 9.2h6.2l.7-9.2" />
      <path d="M8.6 9v4M11.4 9v4" />
    </>
  ),
  refresh: (
    <>
      <path d="M15.6 8.4A5.8 5.8 0 0 0 5.2 6.6M4.4 11.6a5.8 5.8 0 0 0 10.4 1.8" />
      <path d="M15.6 4.6v3.8h-3.8M4.4 15.4v-3.8h3.8" />
    </>
  ),
  play: <path d="M7.4 5.2 14.6 10l-7.2 4.8z" />,
  eye: (
    <>
      <path d="M2.8 10s2.8-4.6 7.2-4.6S17.2 10 17.2 10s-2.8 4.6-7.2 4.6S2.8 10 2.8 10z" />
      <circle cx="10" cy="10" r="2.1" />
    </>
  ),
  check: <path d="m4.6 10.4 3.4 3.4 7.4-8" />,
  plus: <path d="M10 4.6v10.8M4.6 10h10.8" />,
  close: <path d="m5.6 5.6 8.8 8.8M14.4 5.6l-8.8 8.8" />,
  chevron: <path d="m8 5.4 4.6 4.6L8 14.6" />,
  up: <path d="m5.6 12 4.4-4.4L14.4 12" />,
  down: <path d="m5.6 8 4.4 4.4L14.4 8" />,
  alert: (
    <>
      <path d="M10 3.8 17 16H3z" />
      <path d="M10 8.4v3.2" />
      <circle cx="10" cy="13.7" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="10" cy="10" r="6.6" />
      <path d="M10 9.4v4" />
      <circle cx="10" cy="6.9" r="0.85" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 3v1.8M10 15.2V17M3 10h1.8M15.2 10H17M5 5l1.3 1.3M13.7 13.7 15 15M15 5l-1.3 1.3M6.3 13.7 5 15" />
    </>
  ),
  moon: <path d="M15.4 11.8A6 6 0 0 1 8.2 4.6a6.2 6.2 0 1 0 7.2 7.2z" />,
  monitor: (
    <>
      <rect x="3.2" y="4.4" width="13.6" height="9.2" rx="1.6" />
      <path d="M7.6 16.4h4.8M10 13.6v2.8" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="4.8" />
      <path d="m12.6 12.6 3.4 3.4" />
    </>
  ),
  download: (
    <>
      <path d="M10 3.8v8.4M6.4 9l3.6 3.6L13.6 9" />
      <path d="M4.4 15.6h11.2" />
    </>
  ),
  bolt: <path d="M11 3.4 5.4 11h4L9 16.6 14.6 9h-4z" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}

/* ----------------------------------------------------------------- hotkeys */

/**
 * A hotkey drawn as the keys you actually press.
 *
 * "Ctrl + F8" as running text is a sentence about a shortcut; three keycaps
 * are the shortcut. It matters most in the lines list, where every row is one
 * binding and the eye should land on the key, not on the punctuation.
 */
export function Kbd({ spec }: { spec: string }) {
  const pretty = prettyHotkey(spec);
  if (!spec.trim()) {
    return (
      <span className="kbd unset">
        <kbd>not set</kbd>
      </span>
    );
  }
  const parts = pretty.split(" + ");
  return (
    <span className="kbd">
      {parts.map((p, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          {i > 0 && <i>+</i>}
          <kbd>{p}</kbd>
        </span>
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- controls */

export function Toggle({
  on,
  onClick,
  disabled,
  title,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      disabled={disabled}
      className={`switch${on ? " on" : ""}`}
      onClick={onClick}
    />
  );
}

/** One setting: name, optional hint, and the control on the right. */
export function Field({
  name,
  hint,
  children,
  wide,
  badge,
}: {
  name: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  badge?: ReactNode;
}) {
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <div>
        <div className="field-name">
          {name}
          {badge}
        </div>
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

/** Every page opens the same way: what this is, what it does, what you can do
 *  to it from here. */
export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </div>
  );
}

/** Nothing here yet, and what to do about it. */
export function Empty({
  icon,
  title,
  sub,
}: {
  icon: IconName;
  title: string;
  sub?: string;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={22} />
      <div className="empty-title">{title}</div>
      {sub && <div className="empty-sub">{sub}</div>}
    </div>
  );
}
