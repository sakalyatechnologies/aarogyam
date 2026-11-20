import AarogyamShared
import SakalyaUI
import SwiftUI

/// The optional detail chips (spec 1.13): decay depth on a tooth with decay, the condition row
/// (infection, gums, mobility) on every tooth, and a wisdom tooth's eruption and angle. Each tap
/// saves at once; a tap on the picked chip clears it. Skipping them costs nothing.
struct ToothDetailsCard: View {
    let sheet: ToothSheetStateHolder
    let tooth: Int32
    let details: ToothDetailsView
    @State private var save = DetailSaveState(saving: false, error: nil)
    @Environment(\.skTheme) private var theme

    private var condition: ToothConditionView? { details.condition }
    private static let pockets: [Int] = ToothDetailsKt.POCKET_CHIPS_MM.map { $0.intValue }
    private static let grades: [Int] = ToothDetailsKt.MOBILITY_GRADES.map { $0.intValue }

    var body: some View {
        let r = theme.roles
        V7Card {
            VStack(alignment: .leading, spacing: 8) {
                V7Label(text: pv("pv.detail.title"))
                V7Muted(pv("pv.detail.hint"))
                if details.hasCaries {
                    V7Label(text: pv("pv.detail.depth"))
                    SkChoiceChips(Array(CariesDepth.allCases), selected: Set([details.cariesDepth].compactMap { $0 }), label: Self.depth) {
                        sheet.setCariesDepth(tooth: tooth, depth: $0)
                    }
                }
                if !details.missing { conditionRows }
                if details.wisdom { wisdom }
                if save.error != nil {
                    Text(pv("pv.detail.failed")).v7Text(12.5).foregroundStyle(r.error.color)
                }
            }
        }
        .task { for await next in sheet.detail { save = next } }
    }

    /// Infection, gums and mobility, with the date they were recorded.
    @ViewBuilder private var conditionRows: some View {
        V7Label(text: pv("pv.detail.infection"))
        SkChoiceChips(Array(RootInfection.allCases), selected: Set([condition?.infection].compactMap { $0 }), label: Self.infection) { picked in
            sheet.setInfection(tooth: tooth, infection: picked == condition?.infection ? nil : picked)
        }
        if details.canResolveInfection {
            SkPillButton(pv("pv.detail.resolved"), variant: .tonal) { sheet.resolveInfection(tooth: tooth) }
        }
        V7Label(text: pv("pv.detail.gums"))
        V7Flow(spacing: 8) {
            SkChoiceChip(pv("pv.detail.bleeding"), selected: condition?.bleeding?.boolValue == true) {
                sheet.setBleeding(tooth: tooth, on: condition?.bleeding?.boolValue != true)
            }
            ForEach(Self.pockets, id: \.self) { mm in
                SkChoiceChip(pvf("pv.detail.pocket", mm == Self.pockets.last ? "\(mm)+" : "\(mm)"), selected: pocketChip == mm) {
                    sheet.setPocket(tooth: tooth, mm: pocketChip == mm ? nil : KotlinInt(int: Int32(mm)))
                }
            }
        }
        V7Label(text: pv("pv.detail.mobility"))
        SkChoiceChips(Self.grades, selected: Set([condition?.mobility?.intValue].compactMap { $0 }), label: { pvf("pv.detail.mobility.grade", $0) }) { grade in
            let next: KotlinInt? = grade == condition?.mobility?.intValue ? nil : KotlinInt(int: Int32(grade))
            sheet.setMobility(tooth: tooth, grade: next)
        }
        if let date = condition?.at?.date {
            V7Muted(pvf("pv.detail.recorded", ClinicFormat.date(iso: date.isoText)))
        }
    }

    /// A pocket deeper than 7 mm (from the web) lights the "7+" chip.
    private var pocketChip: Int? { condition?.pocketMm.map { min($0.intValue, Self.pockets.last ?? 7) } }

    @ViewBuilder private var wisdom: some View {
        let eruption = details.eruption
        V7Label(text: pv("pv.detail.wisdom"))
        SkChoiceChips(Array(Eruption.allCases), selected: Set([eruption?.eruption].compactMap { $0 }), label: Self.eruption) { picked in
            sheet.setEruption(tooth: tooth, eruption: picked)
        }
        if let eruption, eruption.eruption.takesAngle {
            V7Label(text: pv("pv.detail.angle"))
            SkChoiceChips(Array(Angulation.allCases), selected: Set([eruption.angulation].compactMap { $0 }), label: Self.angle) { picked in
                sheet.setAngulation(tooth: tooth, angulation: picked)
            }
        }
        if let date = eruption?.at?.date {
            V7Muted(pvf("pv.detail.recorded", ClinicFormat.date(iso: date.isoText)))
        }
    }

    private static func depth(_ value: CariesDepth) -> String {
        switch value {
        case .enamel: pv("pv.detail.depth.enamel")
        case .dentin: pv("pv.detail.depth.dentin")
        case .nearPulp: pv("pv.detail.depth.near_pulp")
        }
    }

    private static func infection(_ value: RootInfection) -> String {
        switch value {
        case .infection: pv("pv.detail.infection.infection")
        case .abscess: pv("pv.detail.infection.abscess")
        }
    }

    private static func eruption(_ value: Eruption) -> String {
        switch value {
        case .erupted: pv("pv.detail.eruption.erupted")
        case .partial: pv("pv.detail.eruption.partial")
        case .impacted: pv("pv.detail.eruption.impacted")
        case .unerupted: pv("pv.detail.eruption.unerupted")
        }
    }

    private static func angle(_ value: Angulation) -> String {
        switch value {
        case .vertical: pv("pv.detail.angle.vertical")
        case .mesioangular: pv("pv.detail.angle.mesioangular")
        case .distoangular: pv("pv.detail.angle.distoangular")
        case .horizontal: pv("pv.detail.angle.horizontal")
        }
    }
}
