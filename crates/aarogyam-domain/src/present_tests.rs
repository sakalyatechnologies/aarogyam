use super::*;
use crate::dental_terms::{TermKind, seeded};

fn fixture(text: &str) -> MouthSnapshot {
    let value: serde_json::Value = serde_json::from_str(text).unwrap();
    serde_json::from_value(value["snapshot"].clone()).unwrap()
}

fn adult() -> MouthSnapshot {
    fixture(include_str!(
        "../../../specialties/dental/fixtures/mouth-adult.json"
    ))
}

fn aarav() -> MouthSnapshot {
    fixture(include_str!(
        "../../../specialties/dental/fixtures/mouth-aarav.json"
    ))
}

fn found(studio: &PresentStudio) -> Vec<(u8, &str)> {
    studio
        .situations
        .iter()
        .map(|s| (s.tooth, s.key.as_str()))
        .collect()
}

#[test]
fn situations_come_from_recorded_fields_only() {
    // 14 missing; 37 caries near the pulp; 38 impacted. Nothing else is invented.
    assert_eq!(
        found(&build(&adult())),
        [(14, "missing"), (37, "deep_decay"), (38, "impacted_wisdom")]
    );
    // 21 has a recorded infection; 51 is a missing milk tooth and 55 has dentin decay: no situation.
    assert_eq!(found(&build(&aarav())), [(21, "deep_decay")]);
}

#[test]
fn a_mouth_with_nothing_recorded_has_no_situations() {
    let mut snapshot = adult();
    snapshot.teeth.clear();
    assert_eq!(build(&snapshot), PresentStudio::default());
}

#[test]
fn a_missing_wisdom_tooth_is_not_a_missing_situation() {
    let mut snapshot = adult();
    for t in &mut snapshot.teeth {
        if t.tooth == 14 {
            t.tooth = 18;
        }
    }
    assert!(
        !found(&build(&snapshot))
            .iter()
            .any(|(_, key)| *key == "missing")
    );
}

#[test]
fn each_situation_carries_the_options_with_the_five_facts() {
    let studio = build(&adult());
    let keys = |i: usize| -> Vec<&str> {
        studio.situations[i]
            .options
            .iter()
            .map(|o| o.key.as_str())
            .collect()
    };
    assert_eq!(keys(0), ["implant", "bridge", "leave_gap"]);
    assert_eq!(
        keys(1),
        [
            "wait",
            "rct_crown",
            "extract_implant",
            "extract_bridge",
            "extract"
        ]
    );
    assert_eq!(keys(2), ["remove", "monitor"]);
    for o in studio.situations.iter().flat_map(|s| &s.options) {
        assert!(o.visits.min <= o.visits.max, "{}", o.key);
        assert!(
            !o.looks_like.is_empty() && !o.comfort.is_empty(),
            "{}",
            o.key
        );
        assert_eq!(o.finish.is_some(), o.visits.max > 0, "{}", o.key);
    }
    let implant = &studio.situations[0].options[0];
    assert_eq!(
        implant.lifespan.as_ref().unwrap().words,
        "Most are still working after 10 years"
    );
    // a bridge has no outcome words, so none are invented
    assert!(studio.situations[0].options[1].lifespan.is_none());
}

#[test]
fn nothing_served_is_a_price() {
    let json = serde_json::to_string(&build(&adult())).unwrap();
    for word in ["price", "price_parts", "₹", "cost"] {
        assert!(!json.contains(word), "{word}");
    }
}

fn numbers(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for c in text.chars() {
        if c.is_ascii_digit() || (c == '.' && !current.is_empty()) {
            current.push(c);
        } else if !current.is_empty() {
            out.push(current.trim_end_matches('.').to_owned());
            current.clear();
        }
    }
    if !current.is_empty() {
        out.push(current.trim_end_matches('.').to_owned());
    }
    out
}

#[test]
fn every_number_in_outcome_words_has_a_source_and_a_quote() {
    for (key, o) in &outcomes().unwrap().outcomes {
        let text = format!(
            "{} {}",
            o.words.as_deref().unwrap_or_default(),
            o.why.as_deref().unwrap_or_default()
        );
        if numbers(&text).is_empty() {
            continue;
        }
        let source = o.source.as_deref().unwrap_or_default();
        let quote = o.source_quote.as_deref().unwrap_or_default();
        assert!(
            !source.is_empty() && !quote.is_empty(),
            "{key}: a number needs source and source_quote"
        );
        // each percentage or decimal we state appears in the quote
        for n in numbers(&text).iter().filter(|n| n.contains('.')) {
            assert!(quote.contains(n.as_str()), "{key}: {n} is not in the quote");
        }
    }
}

#[test]
fn outcome_words_never_name_a_longer_period_than_the_follow_up() {
    for (key, o) in &outcomes().unwrap().outcomes {
        let Some(words) = o.words.as_deref() else {
            continue;
        };
        let parts: Vec<&str> = words.split_whitespace().collect();
        for pair in parts.windows(2) {
            if let (true, Ok(years)) = (pair[1].starts_with("year"), pair[0].parse::<u8>()) {
                assert!(
                    o.follow_up_years.is_some_and(|f| years <= f),
                    "{key}: {words}"
                );
            }
        }
    }
}

#[test]
fn the_lint_over_every_present_file() {
    let banned = [
        "guarantee",
        "permanent",
        "painless",
        "100%",
        "will last",
        "lifelong",
    ];
    for text in [OPTIONS, OUTCOMES] {
        let lower = text.to_lowercase();
        // the `$comment` explains the rules, so lint the text after it
        let body = lower.split_once("\"schema_version\"").unwrap().1;
        for word in banned {
            assert!(!body.contains(word), "{word}");
        }
        assert!(!body.contains("+ years") && !body.contains("+years"));
        // a bare range of years or months belongs only to an outcome with a source
        assert!(!body.contains("-year") || text == OUTCOMES);
    }
    for (key, o) in &outcomes().unwrap().outcomes {
        let words = o.words.as_deref().unwrap_or_default().to_lowercase();
        if o.source.is_none() {
            let bare_range = words.contains('–')
                || words.split_whitespace().any(|w| {
                    w.contains('-') && w.chars().next().is_some_and(|c| c.is_ascii_digit())
                });
            assert!(!bare_range, "{key}");
        }
    }
}

#[test]
fn the_option_data_is_consistent() {
    let options = options().unwrap();
    let outcomes = outcomes().unwrap();
    let procedures: Vec<String> = seeded()
        .iter()
        .filter(|t| t.kind == TermKind::Procedure)
        .map(|t| t.id.clone())
        .collect();
    let materials: Vec<String> = seeded()
        .iter()
        .filter(|t| t.kind == TermKind::Material)
        .map(|t| t.id.clone())
        .collect();
    for text in [OPTIONS, OUTCOMES] {
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(v["schema_version"], 1);
        assert_eq!(v["language"], "en");
        assert_eq!(v["reviewed_by"], "pending");
    }
    assert_eq!(
        options
            .situations
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["deep_decay", "impacted_wisdom", "missing"]
    );
    for def in options.situations.values().flat_map(|s| &s.options) {
        assert!(options.comfort.contains_key(&def.comfort), "{}", def.key);
        if let Some(outcome) = &def.outcome {
            assert!(outcomes.outcomes.contains_key(outcome), "{outcome}");
        }
        for part in &def.price_parts {
            assert!(procedures.contains(&part.procedure), "{}", part.procedure);
            if let Some(m) = &part.material {
                assert!(materials.contains(m), "{m}");
            }
        }
    }
}
