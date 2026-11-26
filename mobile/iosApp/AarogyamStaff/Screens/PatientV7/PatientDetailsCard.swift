import AarogyamShared
import SakalyaUI
import SwiftUI

/// A small "Details" card under the header: age and sex, phone and the address when one is on file.
struct PatientDetailsCard: View {
    let view: PatientView
    @Environment(\.skTheme) private var theme

    private var rows: [(label: String, value: String)] {
        let age = view.ageYears.map { pvf("pv.age_short", $0.intValue) }
        let ageSex = [age, view.sex.label].compactMap { $0 }.joined(separator: " · ")
        var out: [(String, String)] = []
        if !ageSex.isEmpty { out.append((pv("pv.details.age_sex"), ageSex)) }
        if let phone = view.phone, !phone.isEmpty { out.append((pv("pv.details.phone"), phone)) }
        if let line = view.address?.oneLine(), !line.isEmpty { out.append((pv("pv.details.address"), line)) }
        return out
    }

    var body: some View {
        let r = theme.roles
        if !rows.isEmpty {
            V7Card {
                VStack(alignment: .leading, spacing: 6) {
                    Text(pv("pv.details.title")).v7Text(15, .heavy).accessibilityAddTraits(.isHeader)
                    ForEach(rows, id: \.label) { row in
                        VStack(alignment: .leading, spacing: 1) {
                            Text(row.label).v7Text(11.5).foregroundStyle(r.onSurfaceVariant.color)
                            Text(row.value).v7Text(14).foregroundStyle(r.onSurface.color)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, SkSpacing.l).padding(.top, 12)
        }
    }
}
