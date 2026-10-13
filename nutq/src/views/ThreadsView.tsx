import { useEffect, useState } from "react";
import { api, events, type Profile, type Thread } from "../lib/api";
import { t } from "../lib/i18n";
import { Empty, Icon, Kbd, PageHead } from "../lib/ui";

/**
 * Idea threads: where thinking out loud adds up.
 *
 * Every thought from a "grow an idea" line joins the thread it belongs to,
 * and the thread's document is rewritten to take it in - so the page leads
 * with the document (where the idea stands now) and keeps the thoughts
 * underneath as the record it was built from.
 *
 * The thought is saved before the model is asked anything, so a failed
 * update shows as a document that is behind, with a Rebuild button - never
 * as a lost thought.
 */

/**
 * The documents are written in a deliberately small Markdown: `## ` headings,
 * `- ` bullets, paragraphs. Small enough to draw here without a parser, and
 * anything else the model slips in still reads fine as plain text.
 */
function Doc({ text }: { text: string }) {
  const blocks: { kind: "h" | "ul" | "p"; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (heading) blocks.push({ kind: "h", lines: [heading[1]] });
    else if (bullet) {
      if (last?.kind === "ul") last.lines.push(bullet[1]);
      else blocks.push({ kind: "ul", lines: [bullet[1]] });
    } else if (last?.kind === "p" && last.lines.length) last.lines.push(line);
    else blocks.push({ kind: "p", lines: [line] });
  }
  /** `**bold**` is the one inline mark models reach for; drop the stars. */
  const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

  return (
    <div className="thread-doc" dir="auto">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.kind === "h" ? (
            <h3 key={i} dir="auto">
              {clean(b.lines[0])}
            </h3>
          ) : b.kind === "ul" ? (
            <ul key={i} dir="auto">
              {b.lines.map((l, j) => (
                <li key={j}>{clean(l)}</li>
              ))}
            </ul>
          ) : (
            <p key={i} dir="auto">
              {clean(b.lines.join(" "))}
            </p>
          ),
        )}
    </div>
  );
}

export default function ThreadsView({ lines }: { lines: Profile[] }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = () =>
    api.getThreads().then((list) => {
      setThreads(list);
      setLoading(false);
    });

  // Polled like Home and History - events into a webview are not reliable
  // here - with the event as a fast path. A growth takes several seconds,
  // and the poll is what turns "updating" back into the new document.
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    const unlisten = events.onThreadsChanged(() => void refresh());
    return () => {
      clearInterval(timer);
      void unlisten.then((un) => un());
    };
  }, []);

  if (loading) return null;

  const current = threads.find((x) => x.id === selected) ?? threads[0] ?? null;
  const pinned = threads.find((x) => x.pinned) ?? null;
  const line = lines.find((l) => l.output === "thread");

  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const addThought = (id: string | null) =>
    act(async () => {
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      await api.addThreadThought(id, text);
    });

  const titleOf = (x: Thread) => x.title || t("Untitled idea");

  return (
    <>
      <PageHead
        eyebrow={t("Thinking out loud")}
        title={t("Idea threads")}
        lede={t(
          "Say what is on your mind. Each thought joins the idea it belongs to, and that idea's document is rewritten to take it in - so an idea grows day by day instead of scattering across notes.",
        )}
        actions={
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const created = await api.createThread("", true);
                setSelected(created.id);
              })
            }
          >
            <Icon name="plus" size={15} />
            {t("New idea")}
          </button>
        }
      />

      {problem && (
        <div className="banner error">
          <Icon name="alert" size={18} className="banner-ico" />
          <div className="banner-text">{problem}</div>
          <div className="banner-actions">
            <button className="btn sm" onClick={() => setProblem(null)}>
              {t("Dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Where the next spoken thought will land - the one thing worth
          knowing before pressing the key. */}
      <div className="thread-route">
        <Icon name={pinned ? "pin" : "sprout"} size={15} />
        {pinned ? (
          <span>
            {t("Every new thought goes to «{title}» until you unpin it.", {
              // An isolate: an Arabic title inside an English sentence (or the
              // other way round) would otherwise drag the quotes out of place.
              title: `\u2068${titleOf(pinned)}\u2069`,
            })}
          </span>
        ) : (
          <span>
            {t("Each new thought goes to the idea it belongs to, or starts a new one.")}
          </span>
        )}
        {line && (
          <span className="thread-route-key">
            {line.name} <Kbd spec={line.hotkey} />
          </span>
        )}
      </div>

      {!current ? (
        <div className="stack">
          <Empty
            icon="sprout"
            title={t("No ideas yet")}
            sub={
              line
                ? t(
                    "Press the {line} hotkey and think out loud. Your first thought starts the first idea.",
                    { line: line.name },
                  )
                : t(
                    "Give a line the destination Grow an idea in Settings, then press its hotkey and think out loud.",
                  )
            }
          />
          <div className="card">
            <div className="card-body">
              <textarea
                rows={3}
                dir="auto"
                value={draft}
                placeholder={t("Or type a thought here")}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  className="btn primary"
                  disabled={busy || !draft.trim()}
                  onClick={() => void addThought(null)}
                >
                  {t("Start an idea")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="threads-layout">
          <div className="threads-list">
            {threads.map((x) => (
              <button
                key={x.id}
                className={`thread-item${x.id === current.id ? " on" : ""}`}
                onClick={() => {
                  setSelected(x.id);
                  setRenaming(null);
                  setConfirmDelete(null);
                }}
              >
                <span className="thread-item-title" dir="auto">
                  {titleOf(x)}
                </span>
                <span className="thread-item-meta">
                  {x.pinned && <Icon name="pin" size={12} />}
                  {x.growing && <span className="dot busy" />}
                  {x.doc_error && !x.growing && <Icon name="alert" size={12} />}
                  {x.entries.length === 1
                    ? t("1 thought")
                    : t("{n} thoughts", { n: x.entries.length })}{" "}
                  ·{" "}
                  <span className="stamp">{x.updated_at.slice(0, 10)}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-head">
                {renaming === current.id ? (
                  <form
                    className="row grow"
                    style={{ flexWrap: "nowrap" }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void act(() => api.renameThread(current.id, nameDraft)).then(() =>
                        setRenaming(null),
                      );
                    }}
                  >
                    <input
                      autoFocus
                      dir="auto"
                      value={nameDraft}
                      placeholder={t("Empty lets the model name it")}
                      style={{ flex: 1, minWidth: 0 }}
                      onChange={(e) => setNameDraft(e.target.value)}
                    />
                    <button className="btn primary sm" type="submit">
                      {t("Save")}
                    </button>
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => setRenaming(null)}
                    >
                      {t("Cancel")}
                    </button>
                  </form>
                ) : (
                  <>
                    <Icon name="sprout" size={17} />
                    <h2 className="note-title" dir="auto">
                      {titleOf(current)}
                    </h2>
                    <button
                      className="icon-btn"
                      title={t("Rename")}
                      aria-label={t("Rename")}
                      onClick={() => {
                        setRenaming(current.id);
                        setNameDraft(current.title);
                      }}
                    >
                      <Icon name="sliders" />
                    </button>
                    <div className="spacer" />
                    <button
                      className={`btn sm${current.pinned ? " primary" : ""}`}
                      disabled={busy}
                      title={
                        current.pinned
                          ? t("Let nutq pick the idea for each thought again")
                          : t("Send every new thought to this idea")
                      }
                      onClick={() =>
                        void act(() => api.pinThread(current.pinned ? null : current.id))
                      }
                    >
                      <Icon name="pin" size={14} />
                      {current.pinned ? t("Pinned") : t("Pin")}
                    </button>
                    <button
                      className="icon-btn"
                      disabled={busy || current.growing || current.entries.length === 0}
                      title={t("Rewrite the document from every thought")}
                      aria-label={t("Rewrite the document from every thought")}
                      onClick={() => void act(() => api.rebuildThread(current.id))}
                    >
                      <Icon name="refresh" />
                    </button>
                    {confirmDelete === current.id ? (
                      <>
                        <button
                          className="btn danger sm"
                          onClick={() =>
                            void act(() => api.deleteThread(current.id)).then(() =>
                              setConfirmDelete(null),
                            )
                          }
                        >
                          {t("Delete")}
                        </button>
                        <button
                          className="btn ghost sm"
                          onClick={() => setConfirmDelete(null)}
                        >
                          {t("Cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        className="icon-btn danger"
                        title={t("Delete this idea")}
                        aria-label={t("Delete this idea")}
                        onClick={() => setConfirmDelete(current.id)}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="card-body">
                {current.growing && (
                  <div className="thread-note">
                    <span className="dot busy" />
                    {t("Updating the document with the latest thought…")}
                  </div>
                )}
                {current.doc_error && !current.growing && (
                  <div className="diag bad">
                    <div className="diag-title">
                      <Icon name="alert" size={15} />
                      {t("The document is behind its thoughts")}
                    </div>
                    <div className="diag-detail">{current.doc_error}</div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button
                        className="btn sm"
                        disabled={busy}
                        onClick={() => void act(() => api.rebuildThread(current.id))}
                      >
                        <Icon name="refresh" size={14} />
                        {t("Rebuild the document")}
                      </button>
                    </div>
                  </div>
                )}
                {current.changes && (
                  <div className="thread-changes">
                    <b>{t("What changed")}</b>
                    <span dir="auto">{current.changes}</span>
                    <span className="stamp">{current.changes_at}</span>
                  </div>
                )}
                {current.doc ? (
                  <Doc text={current.doc} />
                ) : (
                  <div className="hint dim">
                    {current.entries.length
                      ? t("The document appears once the first thought has been worked in.")
                      : t("Nothing here yet. Speak or type the first thought of this idea.")}
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-body">
                <textarea
                  rows={2}
                  dir="auto"
                  value={draft}
                  placeholder={t("Add a thought to this idea")}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      void addThought(current.id);
                    }
                  }}
                />
                <div className="row" style={{ marginTop: 10 }}>
                  <button
                    className="btn primary"
                    disabled={busy || !draft.trim()}
                    onClick={() => void addThought(current.id)}
                  >
                    <Icon name="plus" size={15} />
                    {t("Add the thought")}
                  </button>
                  <span className="hint dim">{t("Ctrl+Enter adds it")}</span>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <Icon name="clock" size={17} />
                <h2>{t("Thoughts")}</h2>
                <span className="chip">{current.entries.length}</span>
                <div className="spacer" />
                <span className="hint dim">
                  {t("Removing one does not change the document until it is rebuilt.")}
                </span>
              </div>
              <div className="card-body">
                {current.entries.length === 0 ? (
                  <div className="hint dim">{t("No thoughts yet.")}</div>
                ) : (
                  <div className="thread-entries">
                    {[...current.entries].reverse().map((e) => (
                      <div className="thread-entry" key={e.id}>
                        <div className="thread-entry-meta">
                          <span className="stamp">{e.at}</span>
                          {e.profile ? (
                            <span className="chip">{e.profile}</span>
                          ) : (
                            <span className="chip">{t("typed")}</span>
                          )}
                          <div className="spacer" />
                          <button
                            className="icon-btn danger"
                            title={t("Remove this thought")}
                            aria-label={t("Remove this thought")}
                            onClick={() =>
                              void act(() => api.removeThreadEntry(current.id, e.id))
                            }
                          >
                            <Icon name="close" />
                          </button>
                        </div>
                        <div className="thread-entry-text" dir="auto">
                          {e.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
