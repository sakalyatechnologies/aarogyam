import AarogyamShared
import SakalyaUI
import SwiftUI

/// The person's clinics; tapping one opens it.
struct ClinicPickerScreen: View {
    let holder: ClinicPickerStateHolder
    let state: ClinicPickerState
    let onSignOut: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                SkLargeTitleHeader(String(localized: "clinics.title"))
                content.padding(.horizontal, SkSpacing.l)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(String(localized: "sign_out"), action: onSignOut)
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .empty:
            SkEmptyState(String(localized: "clinics.empty.title"), message: String(localized: "clinics.empty.message"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "clinics.title"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.retry
            )
        case .choose(let choose):
            list(choose)
        }
    }

    @ViewBuilder private func list(_ state: ClinicPickerStateChoose) -> some View {
        if let error = state.error {
            Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
                .padding(.vertical, SkSpacing.sm)
        }
        SkCard(padding: 0) {
            ForEach(Array(state.clinics.enumerated()), id: \.element.slug) { index, clinic in
                if index > 0 { SkDivider() }
                Button { holder.select(slug: clinic.slug) } label: {
                    SkListRow(clinic.name, subtitle: clinic.roleName, showsChevron: state.opening == nil) {
                        SkAvatar(clinic.name, tone: .brand)
                    } trailing: {
                        if state.opening == clinic.slug {
                            SkChip(String(localized: "clinics.opening"), tone: .info)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(state.opening != nil)
            }
        }
    }
}
