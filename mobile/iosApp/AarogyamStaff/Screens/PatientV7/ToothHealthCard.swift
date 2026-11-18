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
    @State private var note = ""
    @State private var failed = false
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
                if let status {
                    if canRecord {
                        SkField(pv("pv.tooth.health_note"), text: $note)
                        if note.trimmingCharacters(in: .whitespaces) != (status.note ?? "") {
                            SkPillButton(pv("pv.tooth.health_save_note"), wide: true) {
                                sheet.setHealth(tooth: tooth.number, level: status.level, months: status.treatWithinMonths, note: note)
                            }
                        }
                        Button { sheet.clearHealth(tooth: tooth.number) } label: {
                            Text(pv("pv.tooth.health_reset")).v7Text(12.5, .bold).foregroundStyle(r.primary.color).frame(minHeight: 40)
                        }
                    } else if let saved = status.note {
                        V7Muted(saved)
                    }
                }
                if failed {
                    Text(pv("pv.tooth.health_failed")).v7Text(12.5).foregroundStyle(r.error.color)
                }
            }
        }
        .onAppear { note = status?.note ?? ""; sheet.dismissHealthError() }
        .onChange(of: status?.note) { _, saved in note = saved ?? "" }
        .task { for await save in sheet.health { failed = save.error != nil } }
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
