import { useEffect, useState } from "react";
import { api, type TodoList } from "../lib/api";
import { Empty, Icon, PageHead } from "../lib/ui";

/**
 * The to-do page: what the Checklist line has been filing.
 *
 * A checklist dictation is pasted like any other result, but it also lands here
 * as tickable items - so "said it this morning" can be answered from this page
 * tonight, without scrolling History for the transcript.
 */
export default function TodosView() {
  const [lists, setLists] = useState<TodoList[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** Which list is asking to be deleted - a list is minutes of talking. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = () => {
    void api.getTodos().then((l) => {
      setLists(l);
      setLoading(false);
    });
  };

  useEffect(refresh, []);

  if (loading) return null;

  const openTotal = lists.reduce((a, l) => a + l.items.filter((i) => !i.done).length, 0);

  return (
    <>
      <PageHead
        eyebrow="From your Checklist line"
        title="To-do"
        lede="Speak your tasks on the Checklist line and they land here, ready to tick off. Items can also be typed in by hand."
        actions={
          lists.length > 0 ? (
            <span className="chip">{openTotal === 0 ? "all done" : `${openTotal} open`}</span>
          ) : null
        }
      />

      {lists.length === 0 ? (
        <Empty
          icon="checklist"
          title="No lists yet"
          sub="Press the Checklist hotkey, talk through what needs doing, and the list appears here."
        />
      ) : (
        <div className="stack">
          {lists.map((l) => {
            const open = l.items.filter((i) => !i.done).length;
            const done = l.items.length - open;
            const pct = l.items.length ? (done / l.items.length) * 100 : 0;
            return (
              <div className="card" key={l.id}>
                <div className="card-head">
                  <h2 dir="auto" className="note-title">
                    {l.title || l.at}
                  </h2>
                  <span className="chip">{l.at}</span>
                  <span className={`chip${open === 0 ? " ok" : ""}`}>
                    {open === 0 ? "all done" : `${open} open`}
                  </span>
                  <div className="spacer" />
                  {confirmDelete === l.id ? (
                    <>
                      <button
                        className="btn danger sm"
                        onClick={async () => {
                          await api.deleteTodoList(l.id);
                          setConfirmDelete(null);
                          refresh();
                        }}
                      >
                        Delete list
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
                      title="Delete this list"
                      onClick={() => setConfirmDelete(l.id)}
                    >
                      <Icon name="trash" />
                    </button>
                  )}
                </div>

                <div className="card-body">
                  {l.items.length > 0 && (
                    <div className="todo-progress" title={`${done} of ${l.items.length} done`}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  )}

                  <div className="todo-items">
                    {l.items.map((item, i) => (
                      // dir="auto" on the row, not just the text: an Arabic
                      // item flips the whole row, so the checkbox sits beside
                      // the words it ticks rather than across the card.
                      <div
                        className={`todo-item${item.done ? " done" : ""}`}
                        dir="auto"
                        key={i}
                      >
                        <button
                          className={`todo-check${item.done ? " on" : ""}`}
                          title={item.done ? "Mark as open" : "Mark as done"}
                          onClick={async () => {
                            await api.toggleTodo(l.id, i);
                            refresh();
                          }}
                        >
                          {item.done && <Icon name="check" size={12} />}
                        </button>
                        <span className="todo-text">{item.text}</span>
                        <button
                          className="icon-btn danger"
                          title="Remove this item"
                          onClick={async () => {
                            await api.removeTodoItem(l.id, i);
                            refresh();
                          }}
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="row" style={{ flexWrap: "nowrap", marginTop: 12 }}>
                    <input
                      placeholder="add a task by hand"
                      dir="auto"
                      style={{ flex: 1, minWidth: 0 }}
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
                      <Icon name="plus" size={15} />
                      Add
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
