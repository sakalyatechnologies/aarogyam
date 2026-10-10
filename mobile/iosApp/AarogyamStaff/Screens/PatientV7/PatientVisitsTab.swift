import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Visits tab: the mockup's timeline card, newest first (the five most recent the overview loads).
struct PatientVisitsTab: View {
    let visits: [VisitView]
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        if visits.isEmpty {
            V7Card { V7Muted(pv("pv.visits.none")).frame(maxWidth: .infinity) }
        } else {
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(visits, id: \.id) { visit in
                        HStack(alignment: .top, spacing: 10) {
                            Circle().fill(r.primary.color).frame(width: 10, height: 10)
                                .overlay(Circle().stroke(r.primaryContainer.color, lineWidth: 4))
                                .padding(.top, 5).padding(.horizontal, 2)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(alignment: .firstTextBaseline) {
                                    Text(visit.reason ?? visit.number).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                                    if visit.open { V7Pill(text: String(localized: "patient.visit.open"), kind: .done) }
                                }
                                Text(ClinicFormat.date(iso: visit.at.date.isoText)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                                Text([visit.clinician, visit.number].joined(separator: " · ")).v7Text(13).foregroundStyle(r.onSurface.color)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }
}
