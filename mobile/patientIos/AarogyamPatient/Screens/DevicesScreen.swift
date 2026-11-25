import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Signed-in devices: where this account is signed in, with Sign out on the others (after a confirm).
struct DevicesScreen: View {
    let graph: PatientGraph

    var body: some View {
        ScreenHost(make: { graph.devices(screen: $0) }, state: { $0.state }) { holder, state in
            DevicesContent(holder: holder, state: state)
        }
        .navigationTitle(String(localized: "devices.title"))
    }
}

private struct DevicesContent: View {
    let holder: DevicesStateHolder
    let state: DevicesState
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                if let error = state.error {
                    SkEmptyState(error.message, message: "", actionTitle: String(localized: "try_again"), action: holder.refresh)
                }
                if state.loading && state.devices.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                }
                if state.signOutFailed {
                    Text("devices.sign_out_failed").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                }
                ForEach(state.devices, id: \.id) { device in
                    SkCard {
                        Text(device.current ? "devices.this_device" : "devices.other_device")
                            .skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                        if let active = device.lastActive {
                            Text(String(format: String(localized: "devices.last_active"), active.text))
                                .skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                        }
                        if let since = device.signedInAt {
                            Text(String(format: String(localized: "devices.signed_in"), since.dateText))
                                .skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                        }
                        if !device.current {
                            SkButton(String(localized: "sign_out"), variant: .secondary) { holder.askSignOut(id: device.id) }
                                .disabled(state.signingOut != nil)
                        }
                    }
                }
            }
            .padding(SkSpacing.l)
        }
        .refreshable { holder.refresh() }
        .alert(
            String(localized: "devices.confirm.title"),
            isPresented: Binding(get: { state.confirming != nil }, set: { if !$0 { holder.cancelConfirm() } })
        ) {
            Button(String(localized: "sign_out"), role: .destructive) { holder.confirmSignOut() }
            Button(String(localized: "devices.keep"), role: .cancel) { holder.cancelConfirm() }
        } message: {
            Text("devices.confirm.message")
        }
    }
}
