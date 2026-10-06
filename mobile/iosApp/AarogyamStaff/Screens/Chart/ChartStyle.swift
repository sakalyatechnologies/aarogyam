import AarogyamShared
import SakalyaUI
import SwiftUI

// Copy and colours for the chart's shared enums. Copy lives in Chart.xcstrings.

/// How a finding is drawn: a fill, a pattern in `ink`, as the web odontogram and Android draw it.
struct FindingPaint: Equatable {
    enum Pattern: Equatable { case none, solid, stripes, cross, dots, vertical, grid, bars }

    let fill: Color
    let ink: Color
    let pattern: Pattern
}

extension Finding {
    var label: String {
        switch self {
        case .sound: String(localized: "finding.sound", table: "Chart")
        case .caries: String(localized: "finding.caries", table: "Chart")
        case .filled: String(localized: "finding.filled", table: "Chart")
        case .crown: String(localized: "finding.crown", table: "Chart")
        case .rootCanal: String(localized: "finding.root_canal", table: "Chart")
        case .missing: String(localized: "finding.missing", table: "Chart")
        case .implant: String(localized: "finding.implant", table: "Chart")
        case .bridge: String(localized: "finding.bridge", table: "Chart")
        case .fractured: String(localized: "finding.fractured", table: "Chart")
        case .watch: String(localized: "finding.watch", table: "Chart")
        }
    }

    /// The legend's colours, from the clinic palette so they follow light and dark mode.
    func paint(_ p: SkPalette) -> FindingPaint {
        switch self {
        case .sound: FindingPaint(fill: .clear, ink: p.textMuted.color, pattern: .none)
        case .caries: FindingPaint(fill: p.danger.color, ink: p.danger.color, pattern: .solid)
        case .filled: FindingPaint(fill: p.infoSoft.color, ink: p.info.color, pattern: .stripes)
        case .crown: FindingPaint(fill: p.warningSoft.color, ink: p.warning.color, pattern: .solid)
        case .rootCanal: FindingPaint(fill: p.warningSoft.color, ink: p.warning.color, pattern: .vertical)
        case .missing: FindingPaint(fill: .clear, ink: p.textMuted.color, pattern: .none)
        case .implant: FindingPaint(fill: p.brandSoft.color, ink: p.primary.color, pattern: .grid)
        case .bridge: FindingPaint(fill: p.brandSoft.color, ink: p.primary.color, pattern: .bars)
        case .fractured: FindingPaint(fill: p.dangerSoft.color, ink: p.danger.color, pattern: .cross)
        case .watch: FindingPaint(fill: p.warningSoft.color, ink: p.warning.color, pattern: .dots)
        }
    }
}

extension SurfaceName {
    var label: String {
        switch self {
        case .mesial: String(localized: "surface.mesial", table: "Chart")
        case .distal: String(localized: "surface.distal", table: "Chart")
        case .occlusal: String(localized: "surface.occlusal", table: "Chart")
        case .incisal: String(localized: "surface.incisal", table: "Chart")
        case .buccal: String(localized: "surface.buccal", table: "Chart")
        case .facial: String(localized: "surface.facial", table: "Chart")
        case .lingual: String(localized: "surface.lingual", table: "Chart")
        case .palatal: String(localized: "surface.palatal", table: "Chart")
        }
    }
}

extension ToothKind {
    var label: String {
        switch self {
        case .incisor: String(localized: "kind.incisor", table: "Chart")
        case .canine: String(localized: "kind.canine", table: "Chart")
        case .premolar: String(localized: "kind.premolar", table: "Chart")
        case .molar: String(localized: "kind.molar", table: "Chart")
        }
    }

    /// Relative crown widths, so molars are wider than incisors.
    var weight: CGFloat {
        switch self {
        case .incisor: 28
        case .canine: 30
        case .premolar: 34
        case .molar: 42
        }
    }
}

extension EntryStatus {
    /// Null for the current entry, which needs no tag.
    var label: String? {
        switch self {
        case .current: nil
        case .superseded: String(localized: "chart.superseded", table: "Chart")
        case .enteredInError: String(localized: "chart.entered_in_error", table: "Chart")
        }
    }
}

extension Dentition {
    var label: String {
        switch self {
        case .adult: String(localized: "chart.adult", table: "Chart")
        case .child: String(localized: "chart.child", table: "Chart")
        }
    }
}

extension ToothView {
    /// "Mesial", or "Whole tooth" for no surface.
    func surfaceText(_ surface: Surface?) -> String {
        guard let surface else { return String(localized: "chart.whole_tooth", table: "Chart") }
        return surfaceName(surface: surface).label
    }

    /// "Tooth 46, Root canal", the tooth's accessible name.
    var accessibilityText: String {
        String(format: String(localized: "chart.tooth_description", table: "Chart"), Int(number), headline.label)
    }
}

extension HistoryEntryView {
    /// "20 Sept 2026 · Superseded · Pulp exposed", leaving out what is missing.
    var detailText: String {
        [at.map { ClinicFormat.date(iso: $0.date.isoText) }, status.label, note].compactMap { $0 }.joined(separator: " · ")
    }
}
