use super::*;
use time::macros::date;

const VISIT: Date = date!(2026 - 11 - 20);

fn entry(tooth: u8, finding: &str) -> EntryRecord {
    EntryRecord {
        data: ChartData {
            tooth,
            surface: None,
            finding: finding.to_owned(),
            procedure: None,
            material: None,
            note: None,
            canals: Vec::new(),
            sitting: None,
            in_progress: false,
            elsewhere: false,
            caries_depth: None,
        },
        current: true,
        on: VISIT,
        in_visit: true,
        today: true,
    }
}

fn rct(material: Option<&str>) -> EntryRecord {
    let mut e = entry(36, "root_canal");
    e.data.procedure = Some("root_canal".to_owned());
    e.data.in_progress = true;
    e.data.sitting = Some(2);
    e.data.material = material.map(str::to_owned);
    e
}

fn input(entries: Vec<EntryRecord>) -> MouthInput {
    MouthInput {
        visit_on: VISIT,
        age: Some(35),
        entries,
        statuses: Vec::new(),
        conditions: Vec::new(),
        eruptions: Vec::new(),
        done_today: Vec::new(),
        planned: Vec::new(),
        recommended: Vec::new(),
        next_visit: None,
    }
}

fn tooth(snapshot: &MouthSnapshot, number: u8) -> &MouthTooth {
    snapshot
        .teeth
        .iter()
        .find(|t| t.tooth == number)
        .expect("tooth listed")
}

fn states(treatment: &MouthTreatment) -> Vec<(&str, &str)> {
    treatment
        .steps
        .iter()
        .map(|s| (s.key.as_str(), s.state.as_str()))
        .collect()
}

#[test]
fn the_stages_file_parses_and_names_only_seeded_medicaments() {
    let file = stages().expect("treatment-stages.json parses");
    for key in [
        "root_canal",
        "filling",
        "extraction",
        "wisdom_extraction",
        "crown",
        "scaling",
        "implant",
    ] {
        let model = &file.models[key];
        let keys: Vec<&str> = model.steps.iter().map(|s| s.key.as_str()).collect();
        let map = &model.record_map;
        for step in map
            .done_steps
            .iter()
            .chain(&map.in_progress_step)
            .chain(&map.medicament_step)
        {
            assert!(keys.contains(&step.as_str()), "{key}: {step}");
        }
    }
    for model in file.terms.values().chain(file.work_findings.values()) {
        assert!(file.models.contains_key(model), "{model}");
    }
    // DF5: medicaments are seeded materials only.
    for id in &file.models["root_canal"].record_map.medicaments {
        assert!(
            matches!(
                TermRef::stored(TermKind::Material, id),
                Some(TermRef::Seeded(_))
            ),
            "{id}"
        );
    }
    for id in file.material_appearance.keys() {
        assert!(
            matches!(
                TermRef::stored(TermKind::Material, id),
                Some(TermRef::Seeded(_))
            ),
            "{id}"
        );
    }
}

#[test]
fn a_medicament_reaches_the_dressing_and_an_unknown_material_claims_no_step() {
    let mta = snapshot(&input(vec![rct(Some("mta"))]));
    let rc = &tooth(&mta, 36).treatments[0];
    assert_eq!(rc.state, "in_progress");
    assert_eq!(rc.steps[1].state, "current");
    assert_eq!(rc.steps[1].sitting, Some(2));
    let none = snapshot(&input(vec![rct(None)]));
    assert_eq!(
        states(&tooth(&none, 36).treatments[0])[0],
        ("access_clean", "current")
    );
    let custom = snapshot(&input(vec![rct(Some(
        "0190a1b2-0000-7000-8000-000000000001",
    ))]));
    let t = tooth(&custom, 36);
    assert_eq!(t.sitting, Some(2));
    assert!(t.treatments[0].steps.iter().all(|s| s.state == "usual"));
    // A seeded non-medicament other than temporary is unknown too.
    let other = snapshot(&input(vec![rct(Some("zirconia"))]));
    assert!(
        tooth(&other, 36).treatments[0]
            .steps
            .iter()
            .all(|s| s.state == "usual")
    );
}

#[test]
fn next_binds_only_when_one_treatment_is_in_progress() {
    let mut one = input(vec![rct(Some("mta"))]);
    one.next_visit = Some(date!(2026 - 11 - 26));
    let snap = snapshot(&one);
    let step = &tooth(&snap, 36).treatments[0].steps[2];
    assert_eq!((step.state.as_str(), step.on), ("next", one.next_visit));
    assert_eq!(snap.next_visit, one.next_visit);

    let mut crown = entry(46, "crown");
    crown.data.procedure = Some("crown".to_owned());
    crown.data.in_progress = true;
    let mut two = input(vec![rct(Some("mta")), crown]);
    two.next_visit = Some(date!(2026 - 11 - 26));
    let snap = snapshot(&two);
    assert!(
        snap.teeth
            .iter()
            .flat_map(|t| &t.treatments)
            .flat_map(|t| &t.steps)
            .all(|s| s.state != "next")
    );
    assert_eq!(snap.next_visit, two.next_visit);
}

#[test]
fn origin_is_elsewhere_before_or_here_with_a_date() {
    let mut elsewhere = entry(16, "crown");
    elsewhere.data.elsewhere = true;
    elsewhere.data.procedure = Some("crown".to_owned());
    let mut imported = entry(26, "filled");
    imported.data.procedure = Some("filling".to_owned());
    imported.in_visit = false;
    let no_procedure = entry(36, "filled");
    let mut here = entry(46, "filled");
    here.data.procedure = Some("filling".to_owned());
    let snap = snapshot(&input(vec![elsewhere, imported, no_procedure, here]));
    let work = |n| &tooth(&snap, n).work[0];
    assert_eq!(
        (work(16).origin.as_str(), work(16).done_on),
        ("elsewhere", None)
    );
    assert!(
        tooth(&snap, 16).treatments.is_empty(),
        "no stepper elsewhere"
    );
    assert_eq!(
        (work(26).origin.as_str(), work(26).done_on),
        ("before", None)
    );
    // DF4: a work finding with no procedure was charted as existing work.
    assert_eq!(work(36).origin, "before");
    assert_eq!(tooth(&snap, 36).treatments, []);
    assert_eq!(work(46).origin, "here");
    assert_eq!(work(46).done_on, Some(VISIT));
    assert!(work(46).today, "Done here · today");
    assert_eq!(tooth(&snap, 46).treatments[0].state, "done");
}

#[test]
fn health_comes_only_from_a_status_and_plans_only_from_codes() {
    let mut caries = entry(36, "caries");
    caries.data.surface = Some("O".to_owned());
    let mut plan = input(vec![caries]);
    plan.planned = vec![
        procedure(36, None, "Something special"),
        procedure(38, Some("extraction"), ""),
        procedure(
            46,
            Some("0190a1b2-0000-7000-8000-00000000000a"),
            "Extraction",
        ),
    ];
    let snap = snapshot(&plan);
    let t = tooth(&snap, 36);
    assert_eq!(t.health, None);
    assert!(t.planned);
    assert!(t.treatments.is_empty(), "an unmatched name names no model");
    assert_eq!(tooth(&snap, 38).treatments[0].model, "wisdom_extraction");
    assert!(
        tooth(&snap, 46).treatments.is_empty(),
        "a coded item's model comes from its code, not its name"
    );
}

fn procedure(tooth: u8, code: Option<&str>, name: &str) -> ProcedureRecord {
    ProcedureRecord {
        tooth: Some(tooth),
        code: code.map(str::to_owned),
        name: name.to_owned(),
    }
}

#[test]
fn a_proposed_uncoded_item_is_recommended_by_its_name() {
    let mut facts = input(Vec::new());
    facts.recommended = vec![procedure(26, None, "Root canal treatment")];
    let snap = snapshot(&facts);
    let t = tooth(&snap, 26);
    assert!(t.recommended);
    assert!(!t.planned);
    assert_eq!(t.treatments.len(), 1);
    assert_eq!(t.treatments[0].model, "root_canal");
    assert_eq!(t.treatments[0].state, "planned");
    assert!(t.treatments[0].recommended);
    let json = serde_json::to_string(&snap).unwrap();
    assert!(
        !json.contains("Root canal treatment"),
        "typed name in {json}"
    );
    assert!(!json.to_ascii_lowercase().contains("canal treatment"));
}

#[test]
fn an_accepted_item_stays_planned_and_wins_over_a_recommended_duplicate() {
    let mut facts = input(Vec::new());
    facts.planned = vec![procedure(26, None, "RCT 26")];
    facts.recommended = vec![
        procedure(26, Some("root_canal"), ""),
        procedure(36, Some("crown"), ""),
    ];
    let snap = snapshot(&facts);
    let t = tooth(&snap, 26);
    assert!(t.planned);
    assert_eq!(t.treatments.len(), 1, "one mark per model");
    assert_eq!(t.treatments[0].model, "root_canal");
    assert!(!t.treatments[0].recommended);
    let crown = tooth(&snap, 36);
    assert!(crown.recommended && !crown.planned);
    let json = serde_json::to_string(&snap).unwrap();
    assert!(!json.contains("RCT 26"), "typed name in {json}");
    let planned_only = serde_json::to_value(t).unwrap();
    assert!(
        planned_only["treatments"][0].get("recommended").is_none(),
        "skipped when false"
    );
}

#[test]
fn mixed_positions_follow_df1_and_df2() {
    let mut caries = entry(55, "caries");
    caries.data.surface = Some("O".to_owned());
    let mut child = input(vec![entry(15, "missing"), caries, entry(16, "sound")]);
    child.age = Some(9);
    let snap = snapshot(&child);
    assert_eq!(snap.dentition, "mixed");
    let at = |q: u8, i: u8| {
        snap.positions
            .iter()
            .find(|p| (p.quadrant == q || p.quadrant == q + 4) && p.index == i)
            .expect("position")
    };
    // DF1: 15 missing and 55 with caries → 55, with 15 noted.
    assert_eq!(at(1, 5).tooth, 55);
    assert_eq!(at(1, 5).shown, "tooth");
    assert_eq!(
        at(1, 5).other,
        Some(OtherTooth {
            tooth: 15,
            finding: "missing".to_owned()
        })
    );
    // DF2: nothing charted at position 4 → not recorded, never sound.
    assert_eq!(at(1, 4).shown, "not_recorded");
    assert_eq!(at(2, 6).shown, "not_recorded");
    assert_eq!(at(1, 6).shown, "sound");
    assert!(!snap.positions.iter().any(|p| p.index == 8));
}

#[test]
fn any_permanent_tooth_rules_out_child() {
    let charted = |teeth: &[u8]| teeth.iter().copied().collect::<BTreeSet<u8>>();
    // DF3: a 4-year-old with 16 charted.
    assert_eq!(dentition(&charted(&[16]), Some(4)), "mixed");
    assert_eq!(dentition(&charted(&[55, 65]), Some(4)), "child");
    assert_eq!(dentition(&charted(&[]), Some(3)), "child");
    assert_eq!(dentition(&charted(&[16, 55]), Some(30)), "mixed");
    assert_eq!(dentition(&charted(&[16]), Some(30)), "adult");
    assert_eq!(dentition(&charted(&[16]), None), "adult");
    assert_eq!(dentition(&charted(&[]), Some(8)), "mixed");
}

#[test]
fn details_appear_only_when_recorded_and_hide_on_a_missing_tooth() {
    let mut caries = entry(36, "caries");
    caries.data.caries_depth = Some("near_pulp".to_owned());
    let mut facts = input(vec![caries, entry(46, "missing"), entry(26, "caries")]);
    let condition = |tooth| DetailRecord {
        data: ToothConditionData {
            tooth,
            infection: Some("abscess".to_owned()),
            bleeding: Some(true),
            pocket_mm: Some(5),
            mobility: Some(2),
        },
        on: date!(2026 - 11 - 12),
        today: false,
    };
    facts.conditions = vec![condition(36), condition(46)];
    let snap = snapshot(&facts);
    let d36 = tooth(&snap, 36).details.clone().unwrap();
    assert_eq!(d36.caries_depth.as_deref(), Some("near_pulp"));
    assert_eq!(d36.infection.as_deref(), Some("abscess"));
    assert_eq!(d36.condition_on, Some(date!(2026 - 11 - 12)));
    // DT3: infection, mobility and pocket are hidden on a missing tooth.
    let d46 = tooth(&snap, 46).details.clone().unwrap();
    assert_eq!(
        (d46.infection, d46.pocket_mm, d46.mobility, d46.bleeding),
        (None, None, None, Some(true))
    );
    assert_eq!(tooth(&snap, 26).details, None, "no depth recorded");
}

#[test]
fn the_payload_carries_no_notes_or_clinic_labels() {
    let mut noted = entry(36, "filled");
    noted.data.note = Some("Patient anxious, Dr Rao".to_owned());
    noted.data.elsewhere = true;
    noted.data.material = Some("0190a1b2-0000-7000-8000-000000000002".to_owned());
    let mut facts = input(vec![noted]);
    facts.statuses = vec![StatusRecord {
        data: ToothStatusData {
            tooth: 36,
            health: "watch".to_owned(),
            note: Some("Sunrise Dental did this".to_owned()),
            treat_within_months: None,
        },
        today: false,
    }];
    let json = serde_json::to_string(&snapshot(&facts)).unwrap();
    for leaked in ["anxious", "Rao", "Sunrise", "0190a1b2", "note"] {
        assert!(!json.contains(leaked), "{leaked} in {json}");
    }
    assert!(json.contains("\"origin\":\"elsewhere\""));
    assert!(
        json.contains("\"material\":\"composite\""),
        "custom default"
    );
}

fn fixture(name: &str, source: &str) {
    let file: serde_json::Value = serde_json::from_str(source).expect("fixture parses");
    let input: MouthInput =
        serde_json::from_value(file["input"].clone()).expect("fixture input parses");
    let built = serde_json::to_value(snapshot(&input)).unwrap();
    if std::env::var_os("UPDATE_FIXTURES").is_some() {
        let mut updated = file;
        updated["snapshot"] = built;
        let path = format!(
            "{}/../../specialties/dental/fixtures/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        let text = serde_json::to_string_pretty(&updated).unwrap() + "\n";
        std::fs::write(path, text).expect("fixture written");
        return;
    }
    assert_eq!(
        built, file["snapshot"],
        "{name}: run UPDATE_FIXTURES=1 cargo test -p aarogyam-domain mouth, then review"
    );
}

#[test]
fn the_builder_matches_the_golden_fixtures() {
    fixture(
        "mouth-aarav.json",
        include_str!("../../../specialties/dental/fixtures/mouth-aarav.json"),
    );
    fixture(
        "mouth-adult.json",
        include_str!("../../../specialties/dental/fixtures/mouth-adult.json"),
    );
}

#[test]
fn the_aarav_fixture_is_mixed_with_a_root_canal_at_the_dressing() {
    let file: serde_json::Value = serde_json::from_str(include_str!(
        "../../../specialties/dental/fixtures/mouth-aarav.json"
    ))
    .unwrap();
    let input: MouthInput = serde_json::from_value(file["input"].clone()).unwrap();
    let snap = snapshot(&input);
    assert_eq!(snap.dentition, "mixed");
    let drawn: Vec<u8> = snap.positions.iter().map(|p| p.tooth).collect();
    for t in [21, 55, 65, 11, 16, 26, 36, 46] {
        assert!(drawn.contains(&t), "{t} drawn");
    }
    assert!(!drawn.contains(&51), "51 is missing, 11 erupted");
    let rc = &tooth(&snap, 21).treatments[0];
    assert_eq!(
        states(rc),
        [
            ("access_clean", "done"),
            ("dressing", "current"),
            ("obturation", "next"),
            ("restore", "usual")
        ]
    );
    assert_eq!(rc.steps[1].sitting, Some(4));
    assert_eq!(tooth(&snap, 75).work[0].origin, "elsewhere");
    assert_eq!(snap.focus.first(), Some(&21));
}
