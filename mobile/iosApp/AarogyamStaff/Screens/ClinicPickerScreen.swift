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
        .overlay {
            if let opening { OpeningClinicScreen(clinicName: opening.name, role: opening.roleName).transition(.opacity) }
        }
        .animation(.easeOut(duration: 0.25), value: opening?.slug)
        #if DEBUG && AARO_ENV_Local
        // Screenshot runs: `SIMCTL_CHILD_AAROGYAM_DEV_CLINIC=<slug>` opens that clinic.
        .onChange(of: devClinics, initial: true) { _, count in
            if count > 0, let slug = ProcessInfo.processInfo.environment["AAROGYAM_DEV_CLINIC"] { holder.select(slug: slug) }
        }
        #endif
    }

    private var devClinics: Int {
        if case .choose(let choose) = onEnum(of: state) { choose.clinics.count } else { 0 }
    }

    /// The clinic being opened, if any: the spinner screen covers the list while it loads.
    private var opening: ClinicChoice? {
        guard case .choose(let choose) = onEnum(of: state), let slug = choose.opening else { return nil }
        return choose.clinics.first { $0.slug == slug }
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
