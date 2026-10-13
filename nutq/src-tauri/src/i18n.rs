//! The interface language on the Rust side.
//!
//! The frontend translates its own words (`src/lib/i18n.ts`). What Rust
//! writes - provider diagnostics, the warnings and errors that reach the
//! toasts and the Logs page, the tray menu - is translated here, with the
//! same rule: the English is written at the call site, is the lookup key,
//! and is what shows when no Arabic exists. The Arabic lives in
//! `i18n_ar.rs`; a test below fails the build on any `tr`/`trf` string
//! without it.
//!
//! Messages are translated when they are made. A log entry written in
//! English stays English after a switch - it is a record, not a label.

use std::collections::HashMap;
use std::fmt::Display;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

static ARABIC: AtomicBool = AtomicBool::new(false);

/// Follows the `ui_language` setting: "ar", "en", or "system".
pub fn apply(choice: &str) {
    let arabic = match choice {
        "ar" => true,
        "en" => false,
        _ => system_is_arabic(),
    };
    ARABIC.store(arabic, Ordering::Relaxed);
}

/// The Windows display language - the same thing the window's "Match
/// Windows" follows, read without waiting for the webview.
#[cfg(windows)]
fn system_is_arabic() -> bool {
    // The low 10 bits of a LANGID are the primary language; 0x01 is Arabic.
    #[allow(unused_unsafe)]
    let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    id & 0x3ff == 0x01
}

#[cfg(not(windows))]
fn system_is_arabic() -> bool {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .find(|v| !v.is_empty())
        .is_some_and(|v| v.starts_with("ar"))
}

fn table() -> &'static HashMap<&'static str, &'static str> {
    static T: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    T.get_or_init(|| crate::i18n_ar::AR.iter().copied().collect())
}

/// One fixed string.
pub fn tr(en: &'static str) -> &'static str {
    if !ARABIC.load(Ordering::Relaxed) {
        return en;
    }
    table().get(en).copied().unwrap_or(en)
}

/// A string with `{name}` placeholders, filled after translation so the
/// Arabic decides where each value sits.
pub fn trf(en: &'static str, vars: &[(&str, &dyn Display)]) -> String {
    let mut s = tr(en).to_string();
    for (k, v) in vars {
        s = s.replace(&format!("{{{k}}}"), &v.to_string());
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// The value of a Rust string literal whose body starts at `s` (just
    /// after the opening quote), and whether it closed.
    fn literal(s: &str) -> Option<String> {
        let mut out = String::new();
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '"' => return Some(out),
                '\\' => match chars.next()? {
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    '"' => out.push('"'),
                    '\\' => out.push('\\'),
                    '\'' => out.push('\''),
                    // A line continuation: the newline and the next line's
                    // leading whitespace are not part of the string.
                    '\n' => {
                        while chars.peek().is_some_and(|c| c.is_whitespace()) {
                            chars.next();
                        }
                    }
                    other => {
                        out.push('\\');
                        out.push(other);
                    }
                },
                c => out.push(c),
            }
        }
        None
    }

    /// Every string passed to `tr(` or `trf(` in the crate's sources.
    fn used() -> HashSet<String> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut found = HashSet::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if !name.ends_with(".rs") || name == "i18n_ar.rs" || name == "i18n.rs" {
                continue;
            }
            // A Windows checkout may carry CRLF; the keys are written with LF.
            let src = std::fs::read_to_string(&path).unwrap().replace("\r\n", "\n");
            for pat in ["tr(", "trf("] {
                let mut from = 0;
                while let Some(i) = src[from..].find(pat) {
                    let at = from + i;
                    from = at + pat.len();
                    let before = src[..at].chars().last();
                    if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                        continue;
                    }
                    let rest = src[from..].trim_start();
                    if let Some(body) = rest.strip_prefix('"') {
                        if let Some(s) = literal(body) {
                            found.insert(s);
                        }
                    }
                }
            }
        }
        found
    }

    #[test]
    fn every_string_has_arabic_and_every_arabic_is_used() {
        let used = used();
        let keys: HashSet<String> = crate::i18n_ar::AR.iter().map(|(k, _)| k.to_string()).collect();
        let mut missing: Vec<_> = used.difference(&keys).collect();
        let mut unused: Vec<_> = keys.difference(&used).collect();
        missing.sort();
        unused.sort();
        assert!(missing.is_empty(), "no Arabic for: {missing:#?}");
        assert!(unused.is_empty(), "Arabic nothing uses: {unused:#?}");
    }

    #[test]
    fn translations_keep_their_placeholders() {
        for (en, ar) in crate::i18n_ar::AR {
            let mut rest = *en;
            while let Some(open) = rest.find('{') {
                let Some(close) = rest[open..].find('}') else { break };
                let ph = &rest[open..open + close + 1];
                assert!(ar.contains(ph), "{ph} is missing from the Arabic of {en:?}");
                rest = &rest[open + close + 1..];
            }
        }
    }

    #[test]
    fn keys_are_unique() {
        let mut seen = HashSet::new();
        for (en, _) in crate::i18n_ar::AR {
            assert!(seen.insert(*en), "duplicate key {en:?}");
        }
    }

    #[test]
    fn placeholders_fill_in() {
        assert_eq!(trf("{a} and {b}", &[("a", &1), ("b", &"x")]), "1 and x");
    }
}
