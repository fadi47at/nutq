import { useEffect, useState } from "react";
import { api, type TodoList } from "../lib/api";

/**
 * The to-do page: what the Checklist line has been filing.
 *
 * A checklist dictation is pasted like any other result, but it also lands
 * here as tickable items - so "said it this morning" can be answered from
 * this page tonight, without scrolling History for the transcript.
 */
export default function TodosView() {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const refresh = () => {
    void api.getTodos().then((l) => {
      setLists(l);
      setLoading(false);
    });
  };

  useEffect(refresh, []);

  if (loading) return null;

  return (
    <>
      <div className="eyebrow">From your Checklist line</div>
      <h1>To-do</h1>
      <p className="lede">
        Speak your tasks on the Checklist line and they land here, ready to
        tick off. Items can also be typed in by hand.
      </p>

      {lists.length === 0 && (
        <div className="result">
          <div className="result-text empty">
            Nothing yet. Press the Checklist hotkey, talk through what needs
            doing, and the list will appear here.
          </div>
        </div>
      )}

      {lists.map((l) => {
        const open = l.items.filter((i) => !i.done).length;
        return (
          <div className="result" key={l.id}>
            <div className="result-head">
              <h2 style={{ margin: 0 }} dir="auto">
                {l.title || l.at}
              </h2>
              <span className="pill">{l.at}</span>
              <span className="pill">
                {open === 0 ? "all done" : `${open} open`}
              </span>
              <div className="spacer" />
              <button
                className="btn ghost"
                onClick={async () => {
                  await api.deleteTodoList(l.id);
                  refresh();
                }}
              >
                Delete
              </button>
            </div>

            <div className="todo-items">
              {l.items.map((item, i) => (
                <div className={`todo-item${item.done ? " done" : ""}`} key={i}>
                  <button
                    className={`todo-check${item.done ? " on" : ""}`}
                    title={item.done ? "Mark as open" : "Mark as done"}
                    onClick={async () => {
                      await api.toggleTodo(l.id, i);
                      refresh();
                    }}
                  >
                    {item.done && (
                      <svg viewBox="0 0 16 16" width="12" height="12">
                        <path
                          d="m3 8.5 3.2 3.2L13 4.8"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                  <span className="todo-text" dir="auto">
                    {item.text}
                  </span>
                  <button
                    className="icon-btn"
                    title="Remove"
                    onClick={async () => {
                      await api.removeTodoItem(l.id, i);
                      refresh();
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="row" style={{ flex: "none", marginTop: 10 }}>
              <input
                placeholder="add a task by hand"
                dir="auto"
                value={draft[l.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && (draft[l.id] ?? "").trim()) {
                    await api.addTodoItem(l.id, draft[l.id]);
                    setDraft((d) => ({ ...d, [l.id]: "" }));
                    refresh();
                  }
                }}
              />
              <button
                className="btn"
                disabled={!(draft[l.id] ?? "").trim()}
                onClick={async () => {
                  await api.addTodoItem(l.id, draft[l.id] ?? "");
                  setDraft((d) => ({ ...d, [l.id]: "" }));
                  refresh();
                }}
              >
                Add
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
