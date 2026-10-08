//! Scrubbing for text that comes from outside, before it is logged. Browsers send their own
//! error messages and stack traces, which can carry whatever the page was showing, so nothing is
//! logged as sent: quoted values, email addresses, phone-like numbers, UUIDs, tokens and URL
//! query strings are replaced, and long text is cut. Scrubbing is a net, not a promise: the
//! web helpers also send only an error's name, message and stack.

/// What replaces a quoted value, such as the name in `Cannot find 'Asha Rao'`.
const QUOTED: &str = "[q]";
const EMAIL: &str = "[email]";
const NUMBER: &str = "[number]";
const ID: &str = "[id]";
const TOKEN: &str = "[token]";

/// Scrubs free text (an error message or stack trace) and cuts it to `max_chars` characters.
#[must_use]
pub(crate) fn scrub_text(input: &str, max_chars: usize) -> String {
    // Cut first, so a huge body costs little to scrub.
    let cut: String = input.chars().take(max_chars.saturating_mul(2)).collect();
    let unquoted = replace_quoted(&cut);
    let numbered = replace_digit_runs(&unquoted);
    let mut out = String::with_capacity(numbered.len());
    let mut word = String::new();
    for ch in numbered.chars() {
        if is_delimiter(ch) {
            flush_word(&mut out, &mut word);
            out.push(ch);
        } else {
            word.push(ch);
        }
    }
    flush_word(&mut out, &mut word);
    out.chars().take(max_chars).collect()
}

/// Reduces a page path to a route-like shape: no query, no fragment, and any segment that could
/// be an identifier (it has a digit, an `@`, or is long) becomes `:id`.
#[must_use]
pub(crate) fn scrub_route(path: &str) -> String {
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let mut out = String::new();
    for segment in path.split('/').filter(|s| !s.is_empty()).take(8) {
        out.push('/');
        let looks_like_id = segment.len() > 24
            || segment.contains('@')
            || segment.chars().any(|c| c.is_ascii_digit())
            || !segment
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        out.push_str(if looks_like_id { ":id" } else { segment });
    }
    if out.is_empty() {
        out.push('/');
    }
    out
}

fn is_delimiter(ch: char) -> bool {
    ch.is_whitespace()
        || matches!(
            ch,
            ',' | ';' | '(' | ')' | '<' | '>' | '[' | ']' | '{' | '}'
        )
}

fn flush_word(out: &mut String, word: &mut String) {
    if !word.is_empty() {
        out.push_str(&scrub_word(word));
        word.clear();
    }
}

fn scrub_word(word: &str) -> String {
    if word == QUOTED || word == NUMBER {
        return word.to_owned();
    }
    // A URL or path: drop the query and fragment, then clean each path piece.
    let url_like = word.contains("://") || word.starts_with('/');
    let word = if url_like {
        word.split(['?', '#']).next().unwrap_or_default()
    } else {
        word
    };
    if is_email(word) {
        return EMAIL.to_owned();
    }
    if is_jwt(word) {
        return TOKEN.to_owned();
    }
    if !url_like {
        return scrub_piece(word);
    }
    word.split('/')
        .map(scrub_piece)
        .collect::<Vec<_>>()
        .join("/")
}

fn scrub_piece(piece: &str) -> String {
    if is_email(piece) {
        EMAIL.to_owned()
    } else if is_uuid(piece) {
        ID.to_owned()
    } else if piece.len() >= 32
        && piece
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        TOKEN.to_owned()
    } else {
        piece.to_owned()
    }
}

fn is_email(word: &str) -> bool {
    match word.split_once('@') {
        Some((local, domain)) => !local.is_empty() && domain.contains('.') && !domain.contains('@'),
        None => false,
    }
}

fn is_uuid(word: &str) -> bool {
    let bytes = word.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| {
            if matches!(i, 8 | 13 | 18 | 23) {
                *b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}

fn is_jwt(word: &str) -> bool {
    word.starts_with("eyJ") && word.split('.').count() == 3
}

/// Replaces the inside of `'...'`, `"..."` and backtick spans. An unclosed quote hides the rest.
fn replace_quoted(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut open: Option<char> = None;
    for ch in input.chars() {
        match open {
            None if matches!(ch, '\'' | '"' | '`') => {
                // An apostrophe inside a word (don't, it's) is not a quote.
                if ch == '\'' && out.chars().last().is_some_and(char::is_alphanumeric) {
                    out.push(ch);
                } else {
                    open = Some(ch);
                    out.push(ch);
                    out.push_str(QUOTED);
                }
            }
            None => out.push(ch),
            Some(q) if ch == q => {
                open = None;
                out.push(ch);
            }
            Some(_) => {}
        }
    }
    out
}

/// Replaces any run of digits and phone punctuation holding at least seven digits.
fn replace_digit_runs(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() || (chars[i] == '+' && starts_digit(&chars, i + 1)) {
            let mut j = i;
            let mut digits = 0;
            let mut last_digit = i;
            while j < chars.len()
                && (chars[j].is_ascii_digit()
                    || matches!(chars[j], ' ' | '-' | '+' | '(' | ')' | '.'))
            {
                if chars[j].is_ascii_digit() {
                    digits += 1;
                    last_digit = j;
                }
                j += 1;
            }
            if digits >= 7 {
                out.push_str(NUMBER);
                i = last_digit + 1;
            } else {
                out.extend(&chars[i..=last_digit]);
                i = last_digit + 1;
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn starts_digit(chars: &[char], at: usize) -> bool {
    chars.get(at).is_some_and(char::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails_numbers_and_ids_are_replaced() {
        let text = scrub_text(
            "failed for asha@clinic.in, phone +91 98765 43210, id 0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
            500,
        );
        assert!(!text.contains("asha"));
        assert!(!text.contains("98765"));
        assert!(!text.contains("0190a1b2"));
        assert!(text.contains(EMAIL) && text.contains(NUMBER) && text.contains(ID));
    }

    #[test]
    fn quoted_values_are_hidden_but_apostrophes_are_not() {
        let text = scrub_text("Cannot find 'Asha Rao' - don't retry \"Root canal\"", 500);
        assert!(!text.contains("Asha") && !text.contains("Root"));
        assert!(text.contains("don't retry"));
    }

    #[test]
    fn urls_lose_query_and_identifier_segments() {
        let text = scrub_text(
            "at https://portal.example/patients/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/app.js?phone=555&x=1:10:5",
            500,
        );
        assert!(!text.contains("phone="));
        assert!(!text.contains("0190a1b2"));
        assert!(text.contains("portal.example/patients/[id]/app.js"));
    }

    #[test]
    fn tokens_and_jwts_are_replaced() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
        let text = scrub_text(&format!("Bearer {jwt} key {}", "a".repeat(40)), 500);
        assert!(!text.contains("eyJ") && !text.contains(&"a".repeat(40)));
    }

    #[test]
    fn line_and_column_numbers_survive() {
        let text = scrub_text("at render (assets/index-BvQ3x9KZ.js:120:34)", 500);
        assert_eq!(text, "at render (assets/index-BvQ3x9KZ.js:120:34)");
    }

    #[test]
    fn text_is_cut() {
        assert_eq!(scrub_text(&"word ".repeat(200), 50).chars().count(), 50);
    }

    #[test]
    fn routes_lose_identifiers_query_and_depth() {
        assert_eq!(
            scrub_route("/patients/SC-1042/visits?name=Asha#top"),
            "/patients/:id/visits"
        );
        assert_eq!(scrub_route(""), "/");
        assert_eq!(scrub_route("/today"), "/today");
        assert_eq!(scrub_route("/a/b/c/d/e/f/g/h/i/j"), "/a/b/c/d/e/f/g/h");
        assert_eq!(scrub_route("/asha@x.in"), "/:id");
    }
}
