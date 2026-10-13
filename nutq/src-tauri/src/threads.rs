//! Idea threads: thinking out loud that adds up.
//!
//! A line whose destination is "thread" does not paste and does not file a
//! loose note. Each thought it hears joins the *idea it belongs to* - a
//! thread - and that thread's living document is rewritten to take the new
//! thought in: where the idea stands, what was decided, what is still open,
//! what comes next. An idea told in pieces over a week ends up as one
//! document instead of seven scattered notes.
//!
//! Two model calls, both through the refinement provider and its backup:
//!
//! 1. **Route** - which thread does this thought continue? Skipped when a
//!    thread is pinned (the user said "everything goes here for now") or
//!    when there are no threads yet. The answer is a thread id or "new".
//! 2. **Grow** - the thread's current document plus the new thought in,
//!    the rewritten document out, with a title and a short "what changed".
//!
//! The thought itself is saved *before* either call, so a provider that is
//! down costs the document an update, never the user a thought: the thread
//! is marked with the error and its Rebuild button redoes the document from
//! every thought it holds.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::sync::{Mutex, OnceLock};

use crate::settings::{config_dir, Mode, Settings};

/// One spoken (or typed) thought, as it was added.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub at: String,
    pub text: String,
    /// The line that heard it; empty for a thought typed on the page.
    #[serde(default)]
    pub profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Thread {
    pub id: String,
    /// Written by the model from the first thoughts, until the user renames
    /// the thread - after that it is theirs (`title_locked`).
    pub title: String,
    pub title_locked: bool,
    pub created_at: String,
    pub updated_at: String,
    /// Every thought, oldest first: the record the document is built from.
    pub entries: Vec<Entry>,
    /// The living document (light Markdown: `##` headings, `-` bullets).
    pub doc: String,
    /// What the latest thought changed, in a sentence or two.
    pub changes: String,
    pub changes_at: String,
    /// Why the document is behind its thoughts, when it is. Cleared by the
    /// next successful growth.
    pub doc_error: String,
    /// While set, every new thought goes here without routing.
    pub pinned: bool,
    /// Not stored: true while a growth for this thread is in flight, so the
    /// page can say "updating" instead of showing a stale document as done.
    #[serde(skip_deserializing)]
    pub growing: bool,
}

impl Default for Thread {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            title_locked: false,
            created_at: String::new(),
            updated_at: String::new(),
            entries: Vec::new(),
            doc: String::new(),
            changes: String::new(),
            changes_at: String::new(),
            doc_error: String::new(),
            pinned: false,
            growing: false,
        }
    }
}

// ---------------------------------------------------------------- storage

fn path() -> Result<std::path::PathBuf> {
    Ok(config_dir()?.join("threads.json"))
}

/// One lock around every read-modify-write of the file: a thought filed
/// while a growth is saving must not overwrite it, or the other way round.
fn file_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

/// Thread ids with a growth in flight.
fn growing() -> &'static Mutex<HashSet<String>> {
    static G: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    G.get_or_init(|| Mutex::new(HashSet::new()))
}

fn load() -> Vec<Thread> {
    path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_all(threads: &[Thread]) -> Result<()> {
    fs::write(path()?, serde_json::to_string_pretty(threads)?)?;
    Ok(())
}

/// Reads, changes and writes the file under the lock.
fn edit<T>(f: impl FnOnce(&mut Vec<Thread>) -> Result<T>) -> Result<T> {
    let _guard = file_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load();
    let out = f(&mut all)?;
    save_all(&all)?;
    Ok(out)
}

/// Every thread, most recently grown first, with the in-flight flag set.
pub fn list() -> Vec<Thread> {
    let mut all = {
        let _guard = file_lock().lock().unwrap_or_else(|e| e.into_inner());
        load()
    };
    let busy = growing().lock().unwrap_or_else(|e| e.into_inner()).clone();
    for t in &mut all {
        t.growing = busy.contains(&t.id);
    }
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    all
}

pub fn get(id: &str) -> Option<Thread> {
    list().into_iter().find(|t| t.id == id)
}

pub fn pinned() -> Option<String> {
    list().into_iter().find(|t| t.pinned).map(|t| t.id)
}

/// A new, empty thread. Pinned when asked, which unpins any other: "start a
/// new idea and keep talking into it" is what the page's New button means.
pub fn create(id: &str, at: &str, title: &str, pin: bool) -> Result<Thread> {
    edit(|all| {
        if pin {
            for t in all.iter_mut() {
                t.pinned = false;
            }
        }
        let t = Thread {
            id: id.to_string(),
            title: title.trim().to_string(),
            title_locked: !title.trim().is_empty(),
            created_at: at.to_string(),
            updated_at: at.to_string(),
            pinned: pin,
            ..Default::default()
        };
        all.push(t.clone());
        Ok(t)
    })
}

pub fn append(thread_id: &str, entry: Entry) -> Result<()> {
    edit(|all| {
        let t = all
            .iter_mut()
            .find(|t| t.id == thread_id)
            .ok_or_else(|| anyhow!("that thread no longer exists"))?;
        t.updated_at = entry.at.clone();
        t.entries.push(entry);
        Ok(())
    })
}

pub fn rename(id: &str, title: &str) -> Result<()> {
    edit(|all| {
        if let Some(t) = all.iter_mut().find(|t| t.id == id) {
            t.title = title.trim().to_string();
            // An emptied title hands naming back to the model.
            t.title_locked = !t.title.is_empty();
        }
        Ok(())
    })
}

/// Pins one thread (unpinning the rest), or none.
pub fn pin(id: Option<&str>) -> Result<()> {
    edit(|all| {
        for t in all.iter_mut() {
            t.pinned = Some(t.id.as_str()) == id;
        }
        Ok(())
    })
}

pub fn delete(id: &str) -> Result<()> {
    edit(|all| {
        all.retain(|t| t.id != id);
        Ok(())
    })
}

/// Drops one thought. The document keeps what it learned from it until the
/// next rebuild - say so on the page rather than rewriting silently here.
pub fn remove_entry(thread_id: &str, entry_id: &str) -> Result<()> {
    edit(|all| {
        if let Some(t) = all.iter_mut().find(|t| t.id == thread_id) {
            t.entries.retain(|e| e.id != entry_id);
        }
        Ok(())
    })
}

fn apply_growth(id: &str, grown: &Grown, at: &str) -> Result<()> {
    edit(|all| {
        if let Some(t) = all.iter_mut().find(|t| t.id == id) {
            t.doc = grown.document.clone();
            t.changes = grown.changes.clone();
            t.changes_at = at.to_string();
            t.doc_error.clear();
            if !t.title_locked && !grown.title.is_empty() {
                t.title = grown.title.clone();
            }
        }
        Ok(())
    })
}

fn set_error(id: &str, message: &str) {
    let _ = edit(|all| {
        if let Some(t) = all.iter_mut().find(|t| t.id == id) {
            t.doc_error = message.to_string();
        }
        Ok(())
    });
}

// ---------------------------------------------------------------- prompts

fn language_line(cfg: &Settings) -> String {
    let hint = cfg.language_hint.trim();
    if hint.is_empty() {
        "Write in the language the thoughts are spoken in.".into()
    } else {
        format!(
            "The thoughts are spoken in: {hint}. Write the document, its headings, the title \
             and the changes note in that same language (the main one, if several are \
             named), keeping technical terms as the speaker says them."
        )
    }
}

/// The system prompt for growing a thread's document.
pub fn grow_system(cfg: &Settings) -> String {
    format!(
        "You keep the living document of one idea that its owner develops by thinking out \
         loud, a few spoken thoughts at a time over days or weeks.\n\n\
         You receive the current document (empty for a new idea) and new thoughts. Rewrite \
         the document so it reflects everything known so far:\n\
         - Integrate, do not append: merge the new thoughts into the right places, update \
         or replace what they change, and drop what they explicitly reverse.\n\
         - Keep every concrete detail the owner gave: names, numbers, examples, reasons.\n\
         - Never invent facts, plans or decisions the owner did not express.\n\
         - Use these sections, in this order, with headings in the owner's language, and \
         leave out a section that would be empty: the idea in brief (a short paragraph); \
         details (grouped bullets); decisions made; open questions; next steps.\n\
         - Format: `## ` for headings, `- ` for bullets, plain paragraphs. No other markup.\n\n\
         {}\n\n\
         Answer in exactly this shape and nothing else:\n\
         <title>a short name for the idea, at most six words</title>\n\
         <changes>one or two sentences on what the new thoughts added or changed</changes>\n\
         <document>\nthe full rewritten document\n</document>",
        language_line(cfg)
    )
}

/// What the grow call reads: the document so far and the thoughts to add.
/// A rebuild passes an empty document and every thought.
pub fn grow_input(title: &str, doc: &str, thoughts: &[Entry]) -> String {
    let mut out = String::new();
    if !title.trim().is_empty() {
        out.push_str(&format!("Idea: {}\n\n", title.trim()));
    }
    out.push_str("<current_document>\n");
    out.push_str(doc.trim());
    out.push_str("\n</current_document>\n\n<new_thoughts>\n");
    for e in thoughts {
        out.push_str(&format!("[{}] {}\n\n", e.at, e.text.trim()));
    }
    out.push_str("</new_thoughts>");
    out
}

/// The system prompt for picking a thread.
pub fn route_system() -> String {
    "You sort spoken thoughts into the ideas they belong to. You receive a list of \
     existing ideas (an id, a title and the start of each one's document) and one new \
     thought. If the thought clearly continues, refines, questions or extends one of the \
     ideas, answer with that idea's id. If it is about something else, answer `new`. \
     When unsure, answer `new` - a wrong merge is worse than a new idea. Answer with the \
     id or `new` only, no other words."
        .into()
}

/// The newest threads first, capped, each with the head of its document.
pub fn route_input(threads: &[Thread], thought: &str) -> String {
    let mut out = String::from("<ideas>\n");
    for t in threads.iter().take(30) {
        let head: String = t.doc.chars().take(400).collect();
        out.push_str(&format!(
            "<idea id=\"{}\">\n{}\n{}\n</idea>\n",
            t.id,
            if t.title.is_empty() { "(untitled)" } else { t.title.as_str() },
            head.trim()
        ));
    }
    out.push_str("</ideas>\n\n<new_thought>\n");
    out.push_str(thought.trim());
    out.push_str("\n</new_thought>");
    out
}

/// The routed thread id, if the answer names one that exists; None means a
/// new thread (an explicit `new`, or an answer naming nothing we know).
pub fn parse_route(answer: &str, ids: &[String]) -> Option<String> {
    let a = answer.trim().trim_matches('`').trim();
    if a.eq_ignore_ascii_case("new") {
        return None;
    }
    // Exact first; then the longest id mentioned anywhere, so "id 17" or a
    // quoted id still lands, and a short id inside a longer one cannot win.
    if let Some(id) = ids.iter().find(|id| id.as_str() == a) {
        return Some(id.clone());
    }
    ids.iter()
        .filter(|id| a.contains(id.as_str()))
        .max_by_key(|id| id.len())
        .cloned()
}

#[derive(Debug, Clone, PartialEq)]
pub struct Grown {
    pub title: String,
    pub changes: String,
    pub document: String,
}

fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let rest = &text[start..];
    // A model that stops before closing the last tag still delivered the
    // document; take everything to the end rather than lose it.
    Some(match rest.find(close) {
        Some(end) => &rest[..end],
        None => rest,
    })
}

/// Reads the grow answer. None when there is no document in it - a refusal
/// or a reply in some other shape must not blank a thread's document.
pub fn parse_grown(answer: &str) -> Option<Grown> {
    let document = between(answer, "<document>", "</document>")?.trim().to_string();
    if document.is_empty() {
        return None;
    }
    let one_line = |s: Option<&str>| {
        s.unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let title: String = one_line(between(answer, "<title>", "</title>"))
        .trim_matches(['"', '«', '»', '#', ' '])
        .chars()
        .take(80)
        .collect();
    Some(Grown {
        title,
        changes: one_line(between(answer, "<changes>", "</changes>")),
        document,
    })
}

// ---------------------------------------------------------------- growth

/// Where a new thought goes: the pinned thread, the one the model picks, or
/// a new one. Routing failures fall back to a new thread - a thought filed
/// on its own is easy to fix; a thought lost is not.
async fn route(app: &tauri::AppHandle, cfg: &Settings, thought: &str) -> Option<String> {
    if let Some(id) = pinned() {
        return Some(id);
    }
    let threads = list();
    if threads.is_empty() {
        return None;
    }
    let mut c = cfg.clone();
    // Routing is a quick classification - low effort where that applies.
    c.mode = Mode::Natural;
    let ids: Vec<String> = threads.iter().map(|t| t.id.clone()).collect();
    match crate::ask_with_failover(app, &c, &route_system(), &route_input(&threads, thought)).await
    {
        Ok(answer) => parse_route(&answer, &ids),
        Err(e) => {
            crate::emit_warning(
                app,
                format!("Could not decide which idea that thought belongs to, so it started a new one: {e:#}"),
            );
            None
        }
    }
}

/// Files one finished thought: routes it, saves it at once, then rewrites
/// the thread's document. Returns the thread id it landed in.
pub async fn file_thought(
    app: &tauri::AppHandle,
    cfg: &Settings,
    entry: Entry,
) -> Result<String> {
    let target = route(app, cfg, &entry.text).await;
    let id = match target {
        Some(id) => id,
        None => create(&format!("t{}", entry.id), &entry.at, "", false)?.id,
    };
    append(&id, entry.clone())?;
    notify(app);
    grow(app, cfg, &id, Some(&[entry])).await;
    Ok(id)
}

/// Rewrites one thread's document. `thoughts` are the new ones to merge into
/// the current document; None rebuilds it from every thought it holds.
pub async fn grow(app: &tauri::AppHandle, cfg: &Settings, id: &str, thoughts: Option<&[Entry]>) {
    // One growth at a time across the app: two thoughts arriving together
    // would otherwise each rewrite the same old document, and the second
    // save would erase the first thought from it.
    static RUN: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let _turn = RUN.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;

    let Some(thread) = get(id) else { return };
    growing().lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string());
    notify(app);

    let (doc, new): (&str, Vec<Entry>) = match thoughts {
        Some(t) => (thread.doc.as_str(), t.to_vec()),
        None => ("", thread.entries.clone()),
    };
    let mut c = cfg.clone();
    // Rewriting a document is the reasoning-heavy call: Spec's effort.
    c.mode = Mode::Spec;
    let at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let outcome = crate::ask_with_failover(app, &c, &grow_system(cfg), &grow_input(&thread.title, doc, &new))
        .await
        .and_then(|answer| {
            parse_grown(&answer).ok_or_else(|| {
                anyhow!("the model's answer had no document in it, so the old one was kept")
            })
        });
    match outcome {
        Ok(grown) => {
            if let Err(e) = apply_growth(id, &grown, &at) {
                set_error(id, &format!("{e:#}"));
            }
        }
        Err(e) => {
            let msg = format!("{e:#}");
            set_error(id, &msg);
            crate::emit_warning(
                app,
                format!("The thought was saved, but its idea's document could not be updated: {msg}"),
            );
        }
    }

    growing().lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    notify(app);
}

fn notify(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let _ = app.emit("threads-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn route_answers() {
        let known = ids(&["t17", "t170", "t2"]);
        assert_eq!(parse_route("new", &known), None);
        assert_eq!(parse_route(" `NEW` ", &known), None);
        assert_eq!(parse_route("t2", &known), Some("t2".into()));
        // The longest mentioned id wins, so t17 cannot shadow t170.
        assert_eq!(parse_route("It belongs to t170.", &known), Some("t170".into()));
        // Naming nothing we know is a new thread, not a guess.
        assert_eq!(parse_route("t9", &known), None);
    }

    #[test]
    fn grown_is_read_from_tags() {
        let answer = "<title> «تطبيق الموبايل» </title>\n<changes>Added the Android plan.\n</changes>\n<document>\n## الفكرة\nنص\n</document>";
        let g = parse_grown(answer).expect("parsed");
        assert_eq!(g.title, "تطبيق الموبايل");
        assert_eq!(g.changes, "Added the Android plan.");
        assert_eq!(g.document, "## الفكرة\nنص");
    }

    #[test]
    fn unclosed_document_is_kept_and_missing_document_is_refused() {
        let g = parse_grown("<title>X</title><document>\n## A\n- b").expect("parsed");
        assert_eq!(g.document, "## A\n- b");
        assert_eq!(parse_grown("Sorry, I can't help with that."), None);
        assert_eq!(parse_grown("<title>X</title><document>  </document>"), None);
    }

    #[test]
    fn grow_input_carries_doc_and_thoughts() {
        let e = Entry {
            id: "1".into(),
            at: "2026-10-13 09:00:00".into(),
            text: " first thought ".into(),
            profile: String::new(),
        };
        let s = grow_input("Mobile app", "## Brief\nold", &[e]);
        assert!(s.contains("Idea: Mobile app"));
        assert!(s.contains("<current_document>\n## Brief\nold\n</current_document>"));
        assert!(s.contains("[2026-10-13 09:00:00] first thought"));
    }

    #[test]
    fn store_round_trip() {
        let id = "test-thread-round-trip";
        let _ = delete(id);
        // Unpinned: the store is the real one, and a test must not move the
        // user's own pin.
        create(id, "2026-01-01 10:00:00", "", false).unwrap();
        append(
            id,
            Entry { id: "e1".into(), at: "2026-01-01 10:01:00".into(), text: "فكرة".into(), profile: String::new() },
        )
        .unwrap();
        apply_growth(
            id,
            &Grown { title: "عنوان".into(), changes: "c".into(), document: "## d".into() },
            "2026-01-01 10:02:00",
        )
        .unwrap();
        let t = get(id).expect("thread");
        assert_eq!(t.title, "عنوان");
        assert_eq!(t.entries.len(), 1);
        assert!(!t.pinned);
        // A renamed thread keeps its name through the next growth.
        rename(id, "اسمي").unwrap();
        apply_growth(
            id,
            &Grown { title: "آخر".into(), changes: String::new(), document: "## e".into() },
            "2026-01-01 10:03:00",
        )
        .unwrap();
        assert_eq!(get(id).unwrap().title, "اسمي");
        remove_entry(id, "e1").unwrap();
        assert!(get(id).unwrap().entries.is_empty());
        delete(id).unwrap();
        assert!(get(id).is_none());
    }
}
