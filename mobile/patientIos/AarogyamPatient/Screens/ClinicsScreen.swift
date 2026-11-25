import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// My clinics: the linked clinics, a clinic's code to add one, or asking a clinic to connect.
struct ClinicsScreen: View {
    let graph: PatientGraph
    var isFirstRun = false

    var body: some View {
        ScreenHost(make: { graph.clinics(screen: $0) }, state: { $0.state }) { holder, state in
            ClinicsContent(holder: holder, state: state, isFirstRun: isFirstRun, onSignOut: graph.signOut)
        }
        .navigationTitle(String(localized: "clinics.title"))
    }
}

private struct ClinicsContent: View {
    let holder: ClinicsStateHolder
    let state: ClinicsState
    let isFirstRun: Bool
    let onSignOut: () -> Void
    @Environment(\.skTheme) private var theme
    @State private var scanning = false
    @State private var scanNote: String?

    var body: some View {
        let p = theme.palette
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                if state.clinics.isEmpty && !state.loading {
                    SkCard {
                        Text("clinics.empty.title").skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                        Text("clinics.empty.message").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                    }
                }
                if let error = state.error {
                    SkEmptyState(error.message, message: "", actionTitle: String(localized: "try_again"), action: holder.refresh)
                }
                if !state.clinics.isEmpty {
                    SkCard(padding: 0) {
                        ForEach(state.clinics, id: \.id) { clinic in
                            SkListRow(clinic.name, subtitle: String(format: String(localized: "clinic.number"), clinic.patientNumber)) {
                                SkAvatar(clinic.name)
                            }
                        }
                    }
                }
                if let linked = state.linked {
                    SkCard { Text(String(format: String(localized: "clinics.added"), linked.name)).foregroundStyle(p.text.color) }
                }
                addCard
                askCard
            }
            .padding(SkSpacing.l)
        }
        .fullScreenCover(isPresented: $scanning) { scanner }
        .toolbar {
            if isFirstRun {
                ToolbarItem(placement: .topBarTrailing) { Button(String(localized: "sign_out"), action: onSignOut) }
            }
        }
    }

    /// The camera: a code of ours runs the same handling as typing it; anything else is ignored.
    private var scanner: some View {
        NavigationStack {
            QrScanner(
                onScan: { text in
                    scanning = false
                    scanNote = holder.onScanned(text: text) ? nil : String(localized: "clinics.scan.notours")
                },
                onUnavailable: {
                    scanning = false
                    scanNote = String(localized: "clinics.scan.unavailable")
                }
            )
            .ignoresSafeArea()
            .navigationTitle(String(localized: "clinics.scan.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(String(localized: "done")) { scanning = false }
                }
            }
        }
    }

    private var addCard: some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                Text("clinics.add.title").skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
                let error = state.linkError?.message
                SkTextField(
                    String(localized: "clinics.code.label"),
                    text: Binding(get: { state.code }, set: { holder.onCodeChange(text: $0) }),
                    prompt: String(localized: "clinics.code.hint"),
                    message: error,
                    isError: error != nil
                )
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                SkButton(String(localized: "clinics.add"), action: holder.submitCode).disabled(state.busy)
                SkButton(String(localized: "clinics.scan"), variant: .secondary) { scanning = true }.disabled(state.busy)
                if let note = scanNote {
                    Text(note).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.textMuted.color)
                }
            }
        }
    }

    private var askCard: some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                Text("clinics.ask.title").skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
                Text("clinics.ask.message").skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.textMuted.color)
                SkTextField(
                    String(localized: "clinics.ask.label"),
                    text: Binding(get: { state.clinicSlug }, set: { holder.onClinicChange(text: $0) })
                )
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                if state.requested {
                    Text("clinics.ask.sent").skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.text.color)
                }
                SkButton(String(localized: "clinics.ask"), variant: .secondary, action: holder.submitRequest).disabled(state.busy)
            }
        }
    }
}
