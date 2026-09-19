//! The Notes page's store: notes and ideas the dedicated lines file.
//!
//! A line whose destination is "notes" does not paste into whatever field
//! has focus - its finished text lands here instead, tagged with the kind
//! of note it is. One JSON file, newest first; the text stays editable
//! because a dictated note is a starting point, not a record.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::fs;

use crate::settings::config_dir;

/// What kind of note it is - the property that decides where it shows on
/// the page and what the badge says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteKind {
    /// Cleaned up but faithful: filler removed, wording kept.
    Cleaned,
    /// Exactly as spoken, only punctuation fixed.
    Verbatim,
    /// A rambling idea, developed into structure.
    Idea,
}

impl NoteKind {
    /// The line's processing mode implies the kind; a notes destination
    /// never needs its own picker to stay honest.
    pub fn from_mode(mode: &crate::settings::Mode) -> Self {
        match mode {
            crate::settings::Mode::Verbatim => NoteKind::Verbatim,
            crate::settings::Mode::Spec | crate::settings::Mode::Summary => NoteKind::Idea,
            _ => NoteKind::Cleaned,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub at: String,
    pub kind: NoteKind,
    /// The first line, when the note opens with a usable one; the page
    /// falls back to the date when empty.
    pub title: String,
    pub text: String,
    /// Which line produced it, so the badge can say "from Notes line".
    #[serde(default)]
    pub profile: String,
}

fn path() -> Result<std::path::PathBuf> {
    Ok(config_dir()?.join("notes.json"))
}

pub fn list() -> Vec<Note> {
    path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_all(notes: &[Note]) -> Result<()> {
    fs::write(path()?, serde_json::to_string_pretty(notes)?)?;
    Ok(())
}

/// A short first line becomes the title; a sentence or a ramble does not.
fn title_of(text: &str) -> String {
    let first = text.lines().next().unwrap_or("").trim();
    if first.len() <= 80 && !first.ends_with(['.', '؟', '?', '!', '؛', ';']) {
        first.to_string()
    } else {
        String::new()
    }
}

pub fn add(id: &str, at: &str, kind: NoteKind, profile: &str, text: &str) -> Result<()> {
    if text.trim().is_empty() {
        return Ok(());
    }
    let mut notes = list();
    notes.insert(
        0,
        Note {
            id: id.to_string(),
            at: at.to_string(),
            kind,
            title: title_of(text),
            text: text.to_string(),
            profile: profile.to_string(),
        },
    );
    save_all(&notes)
}

pub fn remove(id: &str) -> Result<()> {
    let mut notes = list();
    notes.retain(|n| n.id != id);
    save_all(&notes)
}

/// Hand edits to a dictated note: text, and through it the title.
pub fn update(id: &str, text: &str) -> Result<()> {
    let mut notes = list();
    if let Some(n) = notes.iter_mut().find(|n| n.id == id) {
        n.text = text.to_string();
        n.title = title_of(text);
    }
    save_all(&notes)
}

/// Promotes or demotes a note after the fact - a cleaned note that turns
/// out to be a faithful record, say.
pub fn set_kind(id: &str, kind: NoteKind) -> Result<()> {
    let mut notes = list();
    if let Some(n) = notes.iter_mut().find(|n| n.id == id) {
        n.kind = kind;
    }
    save_all(&notes)
}

#[cfg(test)]
mod tests {
    use super::{add, list, remove, set_kind, NoteKind};

    #[test]
    fn add_update_remove_round_trip() {
        let id = "test-note-round-trip";
        let _ = remove(id);
        add(id, "2026-01-01 10:00:00", NoteKind::Cleaned, "Notes", "فكرة البرنامج\nشرح أطول تحتها").unwrap();
        let n = list().into_iter().find(|n| n.id == id).expect("note filed");
        assert_eq!(n.title, "فكرة البرنامج");
        set_kind(id, NoteKind::Idea).unwrap();
        let n = list().into_iter().find(|n| n.id == id).expect("note");
        assert_eq!(n.kind, NoteKind::Idea);
        remove(id).unwrap();
        assert!(list().iter().all(|n| n.id != id));
    }

    #[test]
    fn empty_text_is_not_filed() {
        let id = "test-note-empty";
        let _ = remove(id);
        add(id, "2026-01-01 10:00:00", NoteKind::Cleaned, "", "  ").unwrap();
        assert!(list().iter().all(|n| n.id != id));
    }
}
