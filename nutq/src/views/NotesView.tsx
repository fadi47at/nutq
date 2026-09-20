import { useEffect, useMemo, useState } from "react";
import { api, type Note, type NoteKind } from "../lib/api";
import { Empty, Icon, PageHead } from "../lib/ui";

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
 * thought is somewhere findable rather than scattered through other apps. Every
 * note keeps its properties: its kind (changeable after the fact), its line, its
 * date, and text that stays editable because dictation is a starting point.
 */
export default function NotesView() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("all");
  const [query, setQuery] = useState("");
  /** The note currently being edited, and its draft text. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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
      <PageHead
        eyebrow="From your Notes and Ideas lines"
        title="Notes"
        lede="Speak on a notes line and the result lands here instead of being pasted - notes and ideas you can come back to, search, and fix up."
        actions={<span className="chip">{notes.length} kept</span>}
      />

      {notes.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", marginBottom: 14 }}>
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
            placeholder="Search notes"
            dir="auto"
            value={query}
            style={{ flex: 1, minWidth: 180 }}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {shown.length === 0 ? (
        <Empty
          icon="note"
          title={notes.length === 0 ? "No notes yet" : "Nothing matches"}
          sub={
            notes.length === 0
              ? "Press a notes-line hotkey, speak, and the note appears here."
              : "Try a different word, or switch the filter back to All."
          }
        />
      ) : (
        <div className="stack">
          {shown.map((n) => {
            const meta = KIND_LABELS[n.kind];
            const open = editing === n.id;
            return (
              <div className="card" key={n.id}>
                <div className="card-head">
                  <h2 className="note-title" dir="auto">
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
                  {n.profile && <span className="chip">via {n.profile}</span>}
                  <span className="chip">{n.at}</span>
                  <div className="spacer" />
                  <button
                    className="icon-btn"
                    title="Copy this note"
                    onClick={async () => {
                      await api.copyText(n.text);
                      setCopied(n.id);
                      setTimeout(() => setCopied(null), 1400);
                    }}
                  >
                    <Icon name={copied === n.id ? "check" : "copy"} />
                  </button>
                  <button
                    className="icon-btn"
                    title={open ? "Stop editing" : "Edit this note"}
                    onClick={() => {
                      setEditing(open ? null : n.id);
                      setDraft(n.text);
                    }}
                  >
                    <Icon name={open ? "close" : "sliders"} />
                  </button>
                  {confirmDelete === n.id ? (
                    <>
                      <button
                        className="btn danger sm"
                        onClick={async () => {
                          await api.deleteNote(n.id);
                          setConfirmDelete(null);
                          refresh();
                        }}
                      >
                        Delete
                      </button>
                      <button
                        className="btn ghost sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="icon-btn danger"
                      title="Delete this note"
                      onClick={() => setConfirmDelete(n.id)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>

                <div className="card-body">
                  {open ? (
                    <>
                      <textarea
                        rows={8}
                        dir="auto"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                      />
                      <div className="row" style={{ marginTop: 10 }}>
                        <button
                          className="btn primary"
                          onClick={async () => {
                            await api.updateNote(n.id, draft);
                            setEditing(null);
                            refresh();
                          }}
                        >
                          Save note
                        </button>
                        <button className="btn ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="note-text" dir="auto">
                      {n.text}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
