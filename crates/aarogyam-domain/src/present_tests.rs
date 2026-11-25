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
    // 14 missing; 37 caries near the pulp; 38 impacted; 36 and 47 have only a planned root canal.
    assert_eq!(
        found(&build(&adult())),
        [
            (14, "missing"),
            (36, "deep_decay"),
            (37, "deep_decay"),
            (38, "impacted_wisdom"),
            (47, "deep_decay")
        ]
    );
    // 21 has a recorded infection; 51 is a missing milk tooth and 55 has dentin decay: no situation.
    assert_eq!(found(&build(&aarav())), [(21, "infection")]);
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
    // Every tooth of the adult fixture has a plan, so no "wait" option is offered and the plan is first.
    assert_eq!(keys(0), ["implant", "bridge"]);
    assert_eq!(
        keys(1),
        ["rct_crown", "extract_implant", "extract_bridge", "extract"]
    );
    assert_eq!(keys(3), ["remove"]);
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
    for text in [
        OPTIONS,
        OUTCOMES,
        CASE_IMPLANT,
        CASE_WISDOM,
        CASE_BRIDGE,
        CASE_SCALING,
        CASE_VENEER,
        CASE_BRACES,
        CASE_ALIGNERS,
        MATERIALS,
    ] {
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
    for text in [OPTIONS, OUTCOMES, MATERIALS] {
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
        ["deep_decay", "impacted_wisdom", "infection", "missing"]
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

#[test]
fn the_implant_case_has_its_five_steps_and_no_patient_facts() {
    let case = implant_case().unwrap();
    let keys: Vec<&str> = case.steps.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, ["gap", "place", "heal", "abutment", "crown"]);
    let v: serde_json::Value = serde_json::from_str(CASE_IMPLANT).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["language"], "en");
    assert_eq!(v["reviewed_by"], "pending");
    let body = CASE_IMPLANT.to_lowercase();
    let body = body.split_once("\"schema_version\"").unwrap().1;
    for word in ["₹", "price", "visit 1", "visit 2"] {
        assert!(!body.contains(word), "{word}");
    }
}

#[test]
fn the_wisdom_case_has_its_five_steps_and_no_patient_facts() {
    let case = usual_case("wisdom").unwrap();
    let keys: Vec<&str> = case.steps.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, ["before", "remove", "day1", "week1", "healed"]);
    let v: serde_json::Value = serde_json::from_str(CASE_WISDOM).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["language"], "en");
    assert_eq!(v["reviewed_by"], "pending");
    let body = CASE_WISDOM.to_lowercase();
    let body = body.split_once("\"schema_version\"").unwrap().1;
    for word in ["₹", "price", "visit 1", "visit 2"] {
        assert!(!body.contains(word), "{word}");
    }
}

#[test]
fn the_bridge_case_has_its_steps_and_no_patient_facts() {
    let case = usual_case("bridge").unwrap();
    let keys: Vec<&str> = case.steps.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, ["bridge_prep", "bridge_fit"]);
    let v: serde_json::Value = serde_json::from_str(CASE_BRIDGE).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["language"], "en");
    assert_eq!(v["reviewed_by"], "pending");
    let body = CASE_BRIDGE.to_lowercase();
    let body = body.split_once("\"schema_version\"").unwrap().1;
    for word in ["₹", "price", "visit 1", "visit 2"] {
        assert!(!body.contains(word), "{word}");
    }
}

#[test]
fn the_scaling_case_has_its_steps_and_no_patient_facts() {
    let case = usual_case("scaling").unwrap();
    let keys: Vec<&str> = case.steps.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, ["scale", "polish", "recheck"]);
    let v: serde_json::Value = serde_json::from_str(CASE_SCALING).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["language"], "en");
    assert_eq!(v["reviewed_by"], "pending");
    let body = CASE_SCALING.to_lowercase();
    let body = body.split_once("\"schema_version\"").unwrap().1;
    for word in ["₹", "price", "visit 1", "visit 2"] {
        assert!(!body.contains(word), "{word}");
    }
}

#[test]
fn the_veneer_case_has_its_steps_and_no_patient_facts() {
    let case = usual_case("veneer").unwrap();
    let keys: Vec<&str> = case.steps.iter().map(|s| s.key.as_str()).collect();
    assert_eq!(keys, ["prep", "veneer"]);
    let v: serde_json::Value = serde_json::from_str(CASE_VENEER).unwrap();
    assert_eq!(v["schema_version"], 1);
    assert_eq!(v["language"], "en");
    assert_eq!(v["reviewed_by"], "pending");
    let body = CASE_VENEER.to_lowercase();
    let body = body.split_once("\"schema_version\"").unwrap().1;
    for word in ["₹", "price", "visit 1", "visit 2"] {
        assert!(!body.contains(word), "{word}");
    }
}

#[test]
fn the_braces_and_aligners_cases_are_example_arch_guidance() {
    for (key, text) in [("braces", CASE_BRACES), ("aligners", CASE_ALIGNERS)] {
        let case = usual_case(key).unwrap();
        let keys: Vec<&str> = case.steps.iter().map(|s| s.key.as_str()).collect();
        assert_eq!(keys, ["today", "month3", "month9", "finish", "retainer"]);
        let v: serde_json::Value = serde_json::from_str(text).unwrap();
        assert_eq!(v["schema_version"], 1);
        assert_eq!(v["language"], "en");
        assert_eq!(v["reviewed_by"], "pending");
        let body = text.to_lowercase();
        let body = body.split_once("\"schema_version\"").unwrap().1;
        for word in ["₹", "price", "visit 1", "visit 2", "visit 3"] {
            assert!(!body.contains(word), "{word}");
        }
        assert!(body.contains("example"));
    }
}

#[test]
fn the_material_data_is_consistent() {
    let materials = materials().unwrap();
    let outcomes = outcomes().unwrap();
    let seeded_materials: Vec<String> = seeded()
        .iter()
        .filter(|t| t.kind == TermKind::Material)
        .map(|t| t.id.clone())
        .collect();
    assert_eq!(
        materials
            .groups
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["crown", "filling", "implant_crown"]
    );
    for (group, g) in &materials.groups {
        assert!(["crown", "implant", "filled"].contains(&g.overlay.as_str()));
        assert!(g.materials.len() >= 2, "{group}");
        for m in &g.materials {
            assert!(seeded_materials.contains(&m.key), "{}", m.key);
            assert!((1..=4).contains(&m.cost_tier), "{}", m.key);
            assert!(m.look.contains_key("paint") && m.look.contains_key("margin_line"));
            if let Some(outcome) = &m.outcome {
                assert!(outcomes.outcomes.contains_key(outcome), "{outcome}");
            }
            // guidance the clinic has not written stays empty
            assert!(m.strength.is_empty() && m.best_for.is_empty(), "{}", m.key);
            assert!(
                !m.summary.is_empty() && !m.looks_like.is_empty(),
                "{}",
                m.key
            );
        }
    }
}

fn settings(map: &[(&str, &str)]) -> PresentSettings {
    PresentSettings {
        show_prices: true,
        price_map: map
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect(),
    }
}

fn list() -> Vec<(String, i64)> {
    vec![("RCT".into(), 600_000), ("CRN".into(), 850_000)]
}

#[test]
fn a_price_needs_every_part_mapped_and_never_matches_by_name() {
    let studio = build(&adult());
    // Only the root canal is mapped: rct_crown (root_canal + crown) has no number.
    let half = prices(&studio, &settings(&[("root_canal", "RCT")]), &list());
    assert!(half.iter().all(|p| p.option_key != "rct_crown"), "{half:?}");
    // Both mapped: the sum.
    let both = prices(
        &studio,
        &settings(&[("root_canal", "RCT"), ("crown", "CRN")]),
        &list(),
    );
    let rct = both.iter().find(|p| p.option_key == "rct_crown").unwrap();
    assert_eq!(rct.from_paise, 1_450_000);
    // A code that is not on the price list (deleted or inactive) leaves the part unmapped.
    let gone = prices(
        &studio,
        &settings(&[("root_canal", "RCT"), ("crown", "OLD")]),
        &list(),
    );
    assert!(gone.iter().all(|p| p.option_key != "rct_crown"));
}

#[test]
fn settings_reject_unknown_fields_keys_and_codes() {
    assert!(serde_json::from_str::<PresentSettings>(r#"{"show_prices":true,"x":1}"#).is_err());
    let codes = vec!["RCT".to_owned()];
    assert!(settings(&[("root_canal", "RCT")]).validate(&codes).is_ok());
    assert!(
        settings(&[("crown:zirconia", "RCT")])
            .validate(&codes)
            .is_ok()
    );
    assert!(settings(&[("Root canal", "RCT")]).validate(&codes).is_err());
    assert!(
        settings(&[("crown:unobtainium", "RCT")])
            .validate(&codes)
            .is_err()
    );
    assert!(settings(&[("crown", "NOPE")]).validate(&codes).is_err());
    // Stored keys other slices add are ignored on read and kept on write.
    let mut stored = serde_json::json!({ "hidden": ["a"], "show_prices": true });
    assert!(PresentSettings::from_stored(&stored).show_prices);
    settings(&[("crown", "RCT")]).merge_into(&mut stored);
    assert_eq!(stored["hidden"], serde_json::json!(["a"]));
    assert_eq!(stored["price_map"]["crown"], "RCT");
}

#[test]
fn an_infection_has_its_own_situation_and_no_wait_option() {
    let studio = build(&aarav());
    let s = &studio.situations[0];
    assert_eq!((s.tooth, s.key.as_str()), (21, "infection"));
    assert_eq!(s.title, "Infection at the root");
    let keys: Vec<&str> = s.options.iter().map(|o| o.key.as_str()).collect();
    assert_eq!(
        keys,
        ["rct_crown", "extract_implant", "extract_bridge", "extract"]
    );
}

#[test]
fn the_option_matching_the_plan_is_suggested_and_first() {
    // Tooth 21 is mid root canal: that option is suggested, and nothing else is.
    let studio = build(&aarav());
    let options = &studio.situations[0].options;
    assert!(options[0].suggested && options[0].key == "rct_crown");
    assert_eq!(options.iter().filter(|o| o.suggested).count(), 1);
    // The adult plans an implant on 14, a root canal on 37 and a wisdom removal on 38.
    let studio = build(&adult());
    let first: Vec<(&str, bool)> = studio
        .situations
        .iter()
        .map(|s| (s.options[0].key.as_str(), s.options[0].suggested))
        .collect();
    assert_eq!(
        first,
        [
            ("implant", true),
            ("rct_crown", true),
            ("rct_crown", true),
            ("remove", true),
            ("rct_crown", true)
        ]
    );
    // With nothing planned, "Wait and watch" is offered first and nothing is suggested.
    let mut snapshot = adult();
    for t in &mut snapshot.teeth {
        t.treatments.clear();
    }
    let studio = build(&snapshot);
    assert_eq!(studio.situations[1].options[0].key, "wait");
    assert!(
        studio
            .situations
            .iter()
            .flat_map(|s| &s.options)
            .all(|o| !o.suggested)
    );
}

#[test]
fn every_situation_has_if_wait_words_in_plain_stages() {
    for (key, def) in &options().unwrap().situations {
        assert!(def.if_wait.len() >= 3, "{key}");
        assert!(
            def.if_wait
                .iter()
                .all(|w| !w.stage.is_empty() && !w.words.is_empty()),
            "{key}"
        );
        for o in def.options.iter().filter(|o| o.is_wait) {
            assert!(
                o.looks_like.to_lowercase().contains("usually")
                    || o.looks_like.contains("over time"),
                "{}",
                o.key
            );
        }
    }
    let studio = build(&adult());
    assert!(studio.situations.iter().all(|s| !s.if_wait.is_empty()));
}
