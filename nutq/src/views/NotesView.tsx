import { useEffect, useMemo, useState } from "react";
import {
  api,
  type Note,
  type NoteKind,
} from "../lib/api";

/** The two sections of the page, and what each badge says. */
const KIND_LABELS: Record<NoteKind, { name: string; hint: string }> = {
  cleaned: { name: "Cleaned", hint: "Filler removed, wording kept" },
  verbatim: { name: "As spoken", hint: "Exactly what you said, punctuation fixed" },
  idea: { name: "Idea", hint: "A rambling thought, developed into structure" },
};

type Section = "notes" | "ideas" | "all";

/**
 * The Notes page: where the Notes and Ideas lines file their results.
 *
 * A notes destination does not paste - the finished text lands here, so the
 * thought is somewhere findable rather than scattered through other apps.
 * Every note keeps its properties: its kind (changeable after the fact),
 * its line, its date, and text that stays editable because dictation is a
 * starting point.
 */
export default function NotesView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("all");
  const [query, setQuery] = useState("");
  /** The note currently being edited, and its draft text. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const refresh = () => {
    void api.getNotes().then((n) => {
      setNotes(n);
      setLoading(false);
    });
  };

  useEffect(refresh, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (section === "notes" && n.kind === "idea") return false;
      if (section === "ideas" && n.kind !== "idea") return false;
      if (q && !`${n.title}\n${n.text}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [notes, section, query]);

  if (loading) return null;

  return (
    <>
      <div className="eyebrow">From your Notes and Ideas lines</div>
      <h1>Notes</h1>
      <p className="lede">
        Speak on a notes line and the result lands here instead of being pasted
        - notes and ideas you can come back to, search, and fix up.
      </p>

      <div className="row" style={{ flexWrap: "wrap" }}>
        <div className="segmented">
          {(
            [
              ["all", "All"],
              ["notes", "Notes"],
              ["ideas", "Ideas"],
            ] as [Section, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={section === id ? "on" : ""}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          placeholder="search notes"
          dir="auto"
          value={query}
          style={{ flex: 1, minWidth: 160 }}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {shown.length === 0 && (
        <div className="result">
          <div className="result-text empty">
            {notes.length === 0
              ? "Nothing yet. Press a notes-line hotkey, speak, and the note will appear here."
              : "Nothing matches here."}
          </div>
        </div>
      )}

      {shown.map((n) => {
        const meta = KIND_LABELS[n.kind];
        const open = editing === n.id;
        return (
          <div className="result" key={n.id}>
            <div className="result-head">
              <h2 style={{ margin: 0 }} dir="auto">
                {n.title || n.at}
              </h2>
              <select
                className="pill-select"
                value={n.kind}
                title={meta.hint}
                onChange={async (e) => {
                  await api.setNoteKind(n.id, e.target.value as NoteKind);
                  refresh();
                }}
              >
                {(Object.keys(KIND_LABELS) as NoteKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k].name}
                  </option>
                ))}
              </select>
              {n.profile && <span className="pill">via {n.profile}</span>}
              <span className="pill">{n.at}</span>
              <div className="spacer" />
              <button
                className="btn"
                onClick={() => void api.copyText(n.text)}
              >
                Copy
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setEditing(open ? null : n.id);
                  setDraft(n.text);
                }}
              >
                {open ? "Cancel" : "Edit"}
              </button>
              <button
                className="btn ghost"
                onClick={async () => {
                  await api.deleteNote(n.id);
                  refresh();
                }}
              >
                Delete
              </button>
            </div>

            {open ? (
              <>
                <textarea
                  rows={6}
                  dir="auto"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <div className="row" style={{ flex: "none", marginTop: 8 }}>
                  <button
                    className="btn primary"
                    onClick={async () => {
                      await api.updateNote(n.id, draft);
                      setEditing(null);
                      refresh();
                    }}
                  >
                    Save
                  </button>
                </div>
              </>
            ) : (
              <div className="result-text" dir="auto">
                {n.text}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
