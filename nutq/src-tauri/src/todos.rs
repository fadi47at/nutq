//! The to-do lists the Checklist line produces.
//!
//! A checklist dictation is pasted like any other result, but it is also
//! parsed into tickable items and filed here, so "said it this morning,
//! open the list tonight" works. One JSON file, newest list first, no cap
//! arithmetic beyond the user deleting lists by hand - a to-do the app
//! dropped silently is worse than a file that grows.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;

use crate::settings::config_dir;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TodoItem {
    pub text: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoList {
    pub id: String,
    pub at: String,
    /// Empty when the speech gave no usable title.
    pub title: String,
    pub items: Vec<TodoItem>,
}

fn path() -> Result<std::path::PathBuf> {
    Ok(config_dir()?.join("todos.json"))
}

pub fn list() -> Vec<TodoList> {
    path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_all(lists: &[TodoList]) -> Result<()> {
    fs::write(path()?, serde_json::to_string_pretty(lists)?)?;
    Ok(())
}

/// The leading markers a checklist line may carry. The checkbox forms come
/// before the plain bullet, so `- [ ]` is consumed whole rather than leaving
/// its `[ ]` behind for `- ` to mangle.
const MARKERS: [&str; 9] = [
    "- [ ] ", "- [x] ", "- [X] ", "- [ ]", "- [x]", "- [X]", "- ", "* ", "• ",
];

/// Turns finished checklist text into tickable items.
///
/// The prompt asks for `- [ ] ` lines, but the model is not the only source:
/// a failed refinement falls back to the raw transcript, and a hand-pasted
/// note can arrive through a retry - so numbered lines and bare bullets are
/// accepted too, and anything that survives stripping empty is dropped.
pub fn parse(text: &str) -> Vec<TodoItem> {
    text.lines()
        .filter_map(|line| {
            let mut t = line.trim();
            if t.is_empty() {
                return None;
            }
            let done = t.starts_with("- [x]") || t.starts_with("- [X]");
            loop {
                let before = t;
                for m in MARKERS {
                    if let Some(rest) = t.strip_prefix(m) {
                        t = rest.trim_start();
                        break;
                    }
                }
                if t == before {
                    break;
                }
            }
            // "1. " and "1) " numbered lines.
            if t.len() > 2 {
                let bytes = t.as_bytes();
                if bytes[0].is_ascii_digit() && (bytes[1] == b'.' || bytes[1] == b')') {
                    t = t[2..].trim_start();
                }
            }
            if t.is_empty() {
                return None;
            }
            Some(TodoItem {
                text: t.to_string(),
                done,
            })
        })
        .collect()
}

/// Files one finished checklist dictation. A single line becomes the title
/// when it is short and there is more behind it; otherwise the date is the
/// title, which is what a list with none would be called anyway.
pub fn add_from_text(id: &str, at: &str, text: &str) -> Result<()> {
    let items = parse(text);
    if items.is_empty() {
        return Ok(());
    }
    let mut title = String::new();
    if items.len() > 1 {
        let first = &items[0].text;
        if first.len() <= 80 && !first.ends_with(['.', '؟', '?', '!', '؛', ';']) {
            title = first.clone();
        }
    }

    let mut lists = list();
    lists.insert(
        0,
        TodoList {
            id: id.to_string(),
            at: at.to_string(),
            title,
            items,
        },
    );
    save_all(&lists)
}

pub fn remove(id: &str) -> Result<()> {
    let mut lists = list();
    lists.retain(|l| l.id != id);
    save_all(&lists)
}

/// Flips one item's done flag. Out-of-range is a no-op rather than an error:
/// the caller is a checkbox the user can see, so a stale click after a
/// concurrent change has nothing useful to say.
pub fn toggle(list_id: &str, index: usize) -> Result<()> {
    let mut lists = list();
    if let Some(l) = lists.iter_mut().find(|l| l.id == list_id) {
        if let Some(item) = l.items.get_mut(index) {
            item.done = !item.done;
        }
    }
    save_all(&lists)
}

/// Appends a hand-typed item, so the list the user is looking at can take a
/// task the microphone did not hear.
pub fn add_item(list_id: &str, text: &str) -> Result<()> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    let mut lists = list();
    if let Some(l) = lists.iter_mut().find(|l| l.id == list_id) {
        l.items.push(TodoItem {
            text: text.to_string(),
            done: false,
        });
    }
    save_all(&lists)
}

pub fn remove_item(list_id: &str, index: usize) -> Result<()> {
    let mut lists = list();
    if let Some(l) = lists.iter_mut().find(|l| l.id == list_id) {
        if index < l.items.len() {
            l.items.remove(index);
        }
    }
    save_all(&lists)
}

#[cfg(test)]
mod tests {
    use super::{add_from_text, list, parse, remove, TodoItem};

    #[test]
    fn parses_prompt_shaped_lines() {
        let items = parse("- [ ] buy milk\n- [x] call the bank\n\nnot a task marker: plain text");
        assert_eq!(items.len(), 3);
        assert!(!items[0].done);
        assert!(items[1].done);
        // A line with no marker is still content - the raw-transcript
        // fallback has none to give.
        assert_eq!(items[2].text, "not a task marker: plain text");
    }

    #[test]
    fn parses_bullets_and_numbers() {
        let items = parse("* first\n1. second\n2) third\n• fourth");
        assert_eq!(
            items,
            vec![
                TodoItem { text: "first".into(), done: false },
                TodoItem { text: "second".into(), done: false },
                TodoItem { text: "third".into(), done: false },
                TodoItem { text: "fourth".into(), done: false },
            ]
        );
    }

    #[test]
    fn drops_blank_lines() {
        assert!(parse("\n  \n- [ ] \n").is_empty());
    }

    /// add/remove round-trip against the real config dir; idempotent cleanup
    /// so a failed run cannot leave the test list behind.
    #[test]
    fn add_and_remove_round_trip() {
        let id = "test-round-trip";
        let _ = remove(id);
        add_from_text(id, "2026-01-01 10:00:00", "- [ ] one\n- [ ] two").unwrap();
        let lists = list();
        let l = lists.iter().find(|l| l.id == id).expect("list filed");
        assert_eq!(l.items.len(), 2);
        // A short first line with more behind it becomes the title.
        assert_eq!(l.title, "one");
        remove(id).unwrap();
        assert!(list().iter().all(|l| l.id != id));
    }
}
