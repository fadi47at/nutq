//! Prompt templates for the refinement pass.
//!
//! The whole product lives here: the modes are not different pipelines, they
//! are different system prompts over the same transcript. Every prompt ends
//! with the same hard rule - emit the text and nothing else - because the
//! output is pasted straight into whatever field has focus. A "Here is your
//! cleaned-up text:" preamble would land in the user document.

use crate::settings::{DictEntry, Mode, Settings, Snippet};

const NEVER_EXPLAIN: &str = "\n\nOutput ONLY the resulting text. No preamble, \
no explanation, no markdown code fences, no quotation marks around it, no \
commentary about what you changed. Your entire response is pasted directly \
into the document the user is typing in.";

const KEEP_LANGUAGE: &str = "Write the output in the same language the speaker \
used. If they mixed languages - for example Arabic speech with English \
technical terms - keep that mixture exactly as they used it. Never translate \
technical terms, product names, or code identifiers.";

fn natural() -> String {
    format!(
        "You are cleaning up a raw voice transcript into text the speaker can \
use as-is.\n\n\
Remove: filler words, hesitations, false starts, self-corrections (keep only \
what they corrected TO), and phrases repeated because they were thinking out \
loud.\n\
Fix: punctuation, sentence boundaries, capitalisation, and obvious \
transcription errors.\n\
Keep: their voice, their word choices, their level of formality, and every \
substantive point they made. Do not summarise and do not add anything they \
did not say.\n\n{KEEP_LANGUAGE}{NEVER_EXPLAIN}"
    )
}

fn verbatim() -> String {
    format!(
        "You are lightly correcting a raw voice transcript.\n\n\
Fix ONLY: punctuation, sentence boundaries, capitalisation, and clear \
spelling or transcription errors.\n\
Change nothing else. Keep filler words, repetitions, and false starts exactly \
as spoken - the speaker wants a faithful record.\n\n\
{KEEP_LANGUAGE}{NEVER_EXPLAIN}"
    )
}

fn spec() -> String {
    format!(
        "The speaker thought out loud about something they want to build, and \
you are turning that ramble into a brief a coding agent can act on.\n\n\
They will have jumped between ideas, doubled back, and left things implicit. \
Your job is to find the actual intent and organise it. Use these headings, \
skipping any that the speech genuinely gives you nothing for:\n\n\
Goal - one or two sentences on what they are trying to build and why.\n\
Requirements - concrete, checkable bullets. Split compound statements.\n\
Constraints - anything they ruled in or out: platforms, tools, budget, style.\n\
Open questions - decisions they left unresolved or contradicted themselves on.\n\n\
Rules: do not invent requirements they did not express. If something was \
ambiguous, put it under Open questions rather than guessing. Prefer their \
words over your paraphrase. Be dense - no filler sentences.\n\n\
{KEEP_LANGUAGE} Use the same language for the headings too.{NEVER_EXPLAIN}"
    )
}

fn summary() -> String {
    format!(
        "Summarise this voice transcript as tight bullet points.\n\n\
One idea per bullet, ordered as the speaker built the argument, not \
necessarily as they said it. Drop anything that was thinking-out-loud rather \
than content. No bullet should restate another.\n\n\
{KEEP_LANGUAGE}{NEVER_EXPLAIN}"
    )
}

/// The checklist prompt's output shape is part of the contract twice over:
/// the To-do page parses these exact lines into tickable items, so a preamble
/// or a numbered list would land as junk text instead of tasks.
fn checklist() -> String {
    format!(
        "The speaker is dictating tasks, to-dos, or things to remember out \
loud, jumping between them and thinking as they go. Turn the ramble into a \
clean checklist.\n\n\
Output one task per line. Every line starts with `- [ ] ` followed by the \
task as a short, actionable phrase. Merge duplicates, drop small talk and \
anything that is not a task, and phrase each one so a stranger could act on \
it. Keep every real task - do not decide some are too small to count.\n\n\
{KEEP_LANGUAGE} Write each task in the language it was spoken in.{NEVER_EXPLAIN}"
    )
}

/// Builds the full system prompt: mode instructions, then the user vocabulary
/// that makes the difference between "Tauri" and "towry".
///
/// A line with its own instructions (`custom_prompt`, set by
/// `Settings::effective`) replaces the mode prompt entirely - that is the
/// "route this line through my own filter" case - but the vocabulary blocks
/// and the never-explain rule still apply, because the output goes to the
/// same place whatever wrote it.
pub fn system_prompt(settings: &Settings) -> String {
    let custom = settings.custom_prompt.trim();
    let base = if custom.is_empty() {
        match settings.mode {
            Mode::Natural => natural(),
            Mode::Verbatim => verbatim(),
            Mode::Spec => spec(),
            Mode::Summary => summary(),
            Mode::Checklist => checklist(),
        }
    } else {
        custom.to_string()
    };

    let mut out = base;

    if !settings.language_hint.trim().is_empty() {
        out.push_str(&format!(
            "\n\nExpected language of the speech: {}.",
            settings.language_hint.trim()
        ));
    }

    if let Some(block) = dictionary_block(&settings.dictionary) {
        out.push_str(&block);
    }
    if let Some(block) = snippet_block(&settings.snippets) {
        out.push_str(&block);
    }

    out
}

/// Corrections the transcriber reliably gets wrong - names, jargon, spellings.
fn dictionary_block(entries: &[DictEntry]) -> Option<String> {
    let usable: Vec<&DictEntry> = entries
        .iter()
        .filter(|e| !e.from.trim().is_empty() && !e.to.trim().is_empty())
        .collect();
    if usable.is_empty() {
        return None;
    }
    let lines: Vec<String> = usable
        .iter()
        .map(|e| format!("- {} -> {}", e.from.trim(), e.to.trim()))
        .collect();
    Some(format!(
        "\n\nVocabulary corrections. The transcriber mishears these; whenever \
the transcript contains something on the left, it almost certainly means the \
term on the right:\n{}",
        lines.join("\n")
    ))
}

/// Spoken triggers that expand to canned text.
fn snippet_block(snippets: &[Snippet]) -> Option<String> {
    let usable: Vec<&Snippet> = snippets
        .iter()
        .filter(|s| !s.trigger.trim().is_empty() && !s.text.trim().is_empty())
        .collect();
    if usable.is_empty() {
        return None;
    }
    let lines: Vec<String> = usable
        .iter()
        .map(|s| format!("- saying \"{}\" means: {}", s.trigger.trim(), s.text.trim()))
        .collect();
    Some(format!(
        "\n\nSnippet expansions. If the speaker says one of these triggers, \
replace it with the expansion:\n{}",
        lines.join("\n")
    ))
}

/// The transcription prompt sent alongside the audio.
///
/// Kept deliberately dumb: this stage should transcribe and nothing more, so
/// that the refinement stage is the only place that changes wording. Mixing
/// the two makes bad output impossible to attribute to a stage.
pub fn transcription_prompt(settings: &Settings) -> String {
    let mut p = String::from(
        "Transcribe this audio exactly as spoken. Include everything the \
         speaker said, in the language they said it in - if they mixed languages, \
         transcribe each part in its own script. Do not translate. Do not summarise. \
         Do not clean up filler words or repetitions. Do not add commentary. Output \
         only the transcript.",
    );
    if !settings.language_hint.trim().is_empty() {
        p.push_str(&format!(
            " The speech is expected to be: {}.",
            settings.language_hint.trim()
        ));
    }
    p.push_str(&dictionary_terms(settings));
    p
}

/// A short vocabulary-only hint for Whisper-shaped endpoints. Their `prompt`
/// field is a continuation seed, not an instruction: on weak or silent audio
/// the model echoes whatever text it was given straight into the transcript
/// ("Do not translate. Do not translate."), so this must never contain
/// sentences - only dictionary terms.
///
/// The language hint is deliberately NOT included, even though it reads like
/// vocabulary. It is prose, and it is written in English ("Arabic (Levantine
/// dialect) mixed with English technical terms") - so seeding Whisper with it
/// pushes the model toward transcribing Arabic speech as English, and on quiet
/// audio it comes back echoed as things like "English subtitles by". The
/// language belongs in the request's own `language` field, which is what
/// `language_code` is for.
pub fn transcription_hint(settings: &Settings) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.extend(
        settings
            .dictionary
            .iter()
            .map(|d| d.to.trim().to_string())
            .filter(|s| !s.is_empty()),
    );
    parts.extend(
        settings
            .snippets
            .iter()
            .map(|s| s.trigger.trim().to_string())
            .filter(|s| !s.is_empty()),
    );
    parts.join(", ")
}

/// The ISO-639-1 code for the configured language, for APIs that take one.
///
/// Whisper-shaped endpoints accept a two-letter `language`; given one they
/// stop guessing per clip, which is where the wrong-language transcripts come
/// from. The setting itself is free prose so it can also brief a chat model,
/// so the code is recovered from it: an explicit two-letter value is taken as
/// is, otherwise the first language named in the text wins. Returns None when
/// nothing is recognised, and the field is then simply omitted - auto-detect
/// is still better than asserting the wrong language.
pub fn language_code(settings: &Settings) -> Option<String> {
    let hint = settings.language_hint.trim().to_lowercase();
    if hint.is_empty() {
        return None;
    }
    if hint.len() == 2 && hint.chars().all(|c| c.is_ascii_alphabetic()) {
        return Some(hint);
    }

    // Ordered by position in the text, so "Arabic mixed with English" is
    // Arabic - the first named language is the one being spoken, and any
    // others are describing what is mixed into it.
    const LANGS: [(&str, &str); 18] = [
        ("arabic", "ar"),
        ("english", "en"),
        ("french", "fr"),
        ("german", "de"),
        ("spanish", "es"),
        ("italian", "it"),
        ("portuguese", "pt"),
        ("russian", "ru"),
        ("turkish", "tr"),
        ("persian", "fa"),
        ("farsi", "fa"),
        ("urdu", "ur"),
        ("hindi", "hi"),
        ("hebrew", "he"),
        ("dutch", "nl"),
        ("japanese", "ja"),
        ("korean", "ko"),
        ("chinese", "zh"),
    ];

    LANGS
        .iter()
        .filter_map(|(name, code)| hint.find(name).map(|at| (at, *code)))
        .min_by_key(|(at, _)| *at)
        .map(|(_, code)| code.to_string())
}

/// Dictionary terms appended to prompts so the transcriber knows the
/// vocabulary it will be corrected against later.
fn dictionary_terms(settings: &Settings) -> String {
    let usable: Vec<&DictEntry> = settings
        .dictionary
        .iter()
        .filter(|e| !e.from.trim().is_empty() && !e.to.trim().is_empty())
        .collect();
    if usable.is_empty() {
        return String::new();
    }
    let terms: Vec<String> = usable.iter().map(|e| e.to.trim().to_string()).collect();
    format!(" Technical terms that may appear: {}.", terms.join(", "))
}

/// Spec mode is a reasoning task and deserves the thinking budget; the cleanup
/// modes are latency-critical and near-mechanical, so they run at low effort.
pub fn effort(mode: Mode) -> &'static str {
    match mode {
        Mode::Spec => "high",
        Mode::Summary | Mode::Checklist => "medium",
        Mode::Natural | Mode::Verbatim => "low",
    }
}

#[cfg(test)]
mod tests {
    use super::{language_code, transcription_hint};
    use crate::settings::{DictEntry, Settings};

    fn with_hint(hint: &str) -> Settings {
        Settings {
            language_hint: hint.into(),
            ..Default::default()
        }
    }

    /// The shipped default names two languages; the one being spoken is the
    /// one named first, not whichever the table happens to list first.
    #[test]
    fn first_named_language_wins() {
        let s = with_hint("Arabic (Levantine dialect) mixed with English technical terms");
        assert_eq!(language_code(&s).as_deref(), Some("ar"));

        let s = with_hint("English with some Arabic words");
        assert_eq!(language_code(&s).as_deref(), Some("en"));
    }

    #[test]
    fn explicit_code_and_unknown_hints() {
        assert_eq!(language_code(&with_hint("ar")).as_deref(), Some("ar"));
        assert_eq!(language_code(&with_hint("")), None);
        assert_eq!(language_code(&with_hint("mostly slang")), None);
    }

    /// The regression that produced "English subtitles by": Whisper's prompt
    /// is a continuation seed, so the English prose hint must stay out of it
    /// while the dictionary vocabulary still gets through.
    #[test]
    fn whisper_hint_is_vocabulary_only() {
        let mut s = with_hint("Arabic (Levantine dialect) mixed with English technical terms");
        s.dictionary = vec![DictEntry {
            from: "towry".into(),
            to: "Tauri".into(),
        }];

        let hint = transcription_hint(&s);
        assert!(!hint.contains("Arabic"), "prose leaked into the seed: {hint}");
        assert!(!hint.contains("English"), "prose leaked into the seed: {hint}");
        assert_eq!(hint, "Tauri");
    }
}
