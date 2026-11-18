import AarogyamShared
import SakalyaUI
import SwiftUI

/// The tooth's health: Healthy, Watch or Needs treatment. Without the doctor's status the chart's
/// suggestion is picked and says so; one tap saves a status (no visit needed). Watch and Needs
/// treatment take a "treat within" time; a one-line note saves with its own button.
struct ToothHealthCard: View {
    let sheet: ToothSheetStateHolder
    let tooth: ToothView
    let status: ToothStatusView?
    let canRecord: Bool
    /// The person's voice-notes language; the chips beside the mic change it for this note.
    var voice: DictationLanguage = .english
    /// Start dictating into the note at once (a long press on the tooth).
    var dictate = false
    @State private var save = HealthSaveState(saving: false, error: nil, note: "", listening: nil, live: nil)
    @State private var language: DictationLanguage?
    @Environment(\.skTheme) private var theme

    private var suggested: HealthLevel? { tooth.suggestedHealth }
    private var level: HealthLevel? { status?.level ?? suggested }
    private var months: [Int] { ToothHealthKt.TREAT_WITHIN_MONTHS.map { $0.intValue } }

    var body: some View {
        let r = theme.roles
        V7Card {
            VStack(alignment: .leading, spacing: 8) {
                V7Label(text: pv("pv.tooth.health"))
                if canRecord {
                    SkChoiceChips(Array(HealthLevel.allCases), selected: Set(level.map { [$0] } ?? []), label: { $0.label }) { picked in
                        if picked != status?.level {
                            sheet.setHealth(tooth: tooth.number, level: picked, months: status?.treatWithinMonths, note: status?.note)
                        }
                    }
                } else {
                    Text(level?.label ?? pv("pv.tooth.health_unassessed")).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                }
                if status == nil {
                    V7Muted(suggested == nil ? pv("pv.tooth.health_unassessed") : pv("pv.tooth.health_suggested"))
                }
                if let status, status.level.advisesTreatment {
                    V7Label(text: pv("pv.tooth.health_within"))
                    if canRecord {
                        SkChoiceChips(months, selected: Set(status.treatWithinMonths.map { [$0.intValue] } ?? []), label: Self.span) { picked in
                            let next: KotlinInt? = picked == status.treatWithinMonths?.intValue ? nil : KotlinInt(int: Int32(picked))
                            sheet.setHealth(tooth: tooth.number, level: status.level, months: next, note: status.note)
                        }
                    } else if let within = status.treatWithinMonths {
                        V7Muted(Self.span(within.intValue))
                    }
                }
                if canRecord && level != nil {
                    noteEditor
                } else if let saved = status?.note {
                    V7Muted(saved)
                }
                if canRecord && status != nil {
                    Button { sheet.clearHealth(tooth: tooth.number) } label: {
                        Text(pv("pv.tooth.health_reset")).v7Text(12.5, .bold).foregroundStyle(r.primary.color).frame(minHeight: 40)
                    }
                }
                if save.error != nil {
                    Text(pv("pv.tooth.health_failed")).v7Text(12.5).foregroundStyle(r.error.color)
                }
            }
        }
        .onAppear {
            sheet.openTooth(tooth: tooth.number)
            if dictate && canRecord && level != nil { sheet.dictateHealthNote(tooth: tooth.number, language: chosen) }
        }
        .task { for await next in sheet.health { save = next } }
    }

    private var chosen: DictationLanguage { language ?? voice }

    /// The one-line note: typed, or dictated in the chosen language; saved with the tooth's health.
    @ViewBuilder private var noteEditor: some View {
        let listening = save.listening != nil
        SkField(pv("pv.tooth.health_note"), text: Binding(get: { save.note }, set: { sheet.editHealthNote(text: $0) }))
        if let live = save.live { V7Muted(live) }
        HStack(spacing: 8) {
            SkPillButton(listening ? pv("pv.tooth.note_stop") : pv("pv.tooth.note_dictate"), variant: .tonal, icon: nil) {
                if listening { sheet.stopHealthDictation() } else { sheet.dictateHealthNote(tooth: tooth.number, language: chosen) }
            }
            SkChoiceChips(Array(DictationLanguage.allCases), selected: [save.listening ?? chosen], label: { $0.shortCode }) {
                if !listening { language = $0 }
            }
        }
        if !listening && save.note.trimmingCharacters(in: .whitespaces) != (status?.note ?? "") {
            SkPillButton(pv("pv.tooth.health_save_note"), wide: true) { sheet.saveHealthNote(tooth: tooth.number) }
        }
    }

    static func span(_ months: Int) -> String {
        String(localized: "pv.tooth.health_months \(months)", table: "PatientV7")
    }
}

extension HealthLevel {
    var label: String {
        switch self {
        case .healthy: pv("pv.tooth.health_healthy")
        case .watch: pv("pv.tooth.health_watch")
        case .needsTreatment: pv("pv.tooth.health_needs")
        }
    }
}

extension HealthMark {
    /// The Health view's colours: healthy green, watch yellow, needs treatment red; not assessed plain.
    var tone: JawTone {
        switch self {
        case .healthy: .treated
        case .watch: .watch
        case .needsTreatment: .care
        case .notAssessed: .plain
        case .missing: .missing
        }
    }

    var label: String {
        switch self {
        case .healthy: pv("pv.tooth.health_healthy")
        case .watch: pv("pv.tooth.health_watch")
        case .needsTreatment: pv("pv.tooth.health_needs")
        case .notAssessed: pv("pv.jaw.not_assessed")
        case .missing: pv("pv.jaw.missing")
        }
    }
}

extension DictationLanguage {
    /// EN, HI, MR or GU: the short switch beside the tooth note's mic.
    var shortCode: String { String(tag.prefix(2)).uppercased() }
}
