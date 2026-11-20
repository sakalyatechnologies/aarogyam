import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Allergy warning": the clinic's check while medicines are added. Danger-toned when anything is
/// serious, else warning-toned. It never blocks Issue, which checks again.
struct RxCheckBanner: View {
    let state: RxSheetState
    @Environment(\.skTheme) private var theme

    var body: some View {
        if state.showsCheck {
            let p = theme.palette
            let ink = state.checkSerious ? p.dangerText.color : p.warningText.color
            VStack(alignment: .leading, spacing: SkSpacing.xs) {
                Text("rx.check.title").font(.system(size: 14, weight: .heavy)).foregroundStyle(ink)
                ForEach(Array(state.checkAlerts.enumerated()), id: \.offset) { _, alert in
                    Text(alert.message).font(.system(size: 12.5)).foregroundStyle(ink)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(SkSpacing.m)
            .background(state.checkSerious ? p.dangerSoft.color : p.warningSoft.color, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
        }
    }
}
