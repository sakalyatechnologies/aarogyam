import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Register your clinic": the same request the web page sends; Sakalya reviews it and emails the
/// owner's invitation. The form is the RegistrationStateHolder's; this only draws it.
struct RegistrationScreen: View {
    let holder: RegistrationStateHolder
    let state: RegistrationState
    let onBack: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("t7.reg.title", tableName: "TodayV7").font(.system(size: 29, weight: .heavy)).tracking(-0.6)
                    .foregroundStyle(r.onSurface.color).accessibilityAddTraits(.isHeader)
                Text("t7.reg.subtitle", tableName: "TodayV7").font(.system(size: 15)).foregroundStyle(r.onSurfaceVariant.color)
                if state.received { received } else { form }
            }
            .padding(.horizontal, SkSpacing.xl).padding(.top, 64).padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .topLeading) {
            Button(action: onBack) { V7Icon(name: "back", size: 20).frame(width: 40, height: 40).background(.ultraThinMaterial, in: Circle()) }
                .buttonStyle(.skPressable).padding(.leading, 12).padding(.top, 6)
                .accessibilityLabel(String(localized: "t7.back", table: "TodayV7"))
        }
    }

    private func error(_ field: RegistrationField, _ key: String.LocalizationValue) -> String? {
        state.invalid.contains(field) ? String(localized: key, table: "TodayV7") : nil
    }

    @ViewBuilder private var form: some View {
        SkField(String(localized: "t7.reg.clinic", table: "TodayV7"), text: bind({ $0.clinicName }, { $0.updating(clinicName: $1) }), error: error(.clinicName, "t7.reg.required"), contentType: .organizationName)
        SkField(String(localized: "t7.reg.city", table: "TodayV7"), text: bind({ $0.city }, { $0.updating(city: $1) }), error: error(.city, "t7.reg.required"), contentType: .addressCity)
        SkField(String(localized: "t7.reg.contact", table: "TodayV7"), text: bind({ $0.contactName }, { $0.updating(contactName: $1) }), error: error(.contactName, "t7.reg.required"), contentType: .name)
        SkField(String(localized: "sign_in.email_label"), text: bind({ $0.email }, { $0.updating(email: $1) }), error: error(.email, "t7.reg.bad_email"), contentType: .emailAddress, keyboard: .emailAddress)
            .textInputAutocapitalization(.never).autocorrectionDisabled()
        SkField(String(localized: "t7.reg.phone", table: "TodayV7"), text: bind({ $0.phone }, { $0.updating(phone: $1) }), error: error(.phone, "t7.reg.bad_phone"), contentType: .telephoneNumber, keyboard: .phonePad)
        V7Label(text: String(localized: "t7.reg.specialty", table: "TodayV7"))
        HStack(spacing: 8) {
            SkChoiceChip(String(localized: "t7.reg.dental", table: "TodayV7"), selected: state.specialty == .dental) { holder.update { $0.updating(specialty: .dental) } }
            SkChoiceChip(String(localized: "t7.reg.general", table: "TodayV7"), selected: state.specialty == .general) { holder.update { $0.updating(specialty: .general) } }
        }
        SkField(String(localized: "t7.reg.message", table: "TodayV7"), text: bind({ $0.message }, { $0.updating(message: $1) }))
        if let message = state.error?.message { Text(message).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.roles.error.color) }
        SkPillButton(String(localized: "t7.reg.send", table: "TodayV7"), wide: true, loading: state.sending) { holder.send() }.padding(.top, 6)
    }

    private var received: some View {
        VStack(spacing: 14) {
            SkCheckDraw().frame(width: 64, height: 64)
            Text("t7.reg.received", tableName: "TodayV7").font(.system(size: 20, weight: .heavy)).foregroundStyle(theme.roles.onSurface.color)
            Text("t7.reg.received_message", tableName: "TodayV7").font(.system(size: 14)).foregroundStyle(theme.roles.onSurfaceVariant.color).multilineTextAlignment(.center)
            SkPillButton(String(localized: "t7.reg.done", table: "TodayV7"), wide: true, action: onBack)
        }
        .frame(maxWidth: .infinity).padding(.top, 24)
    }

    /// A text binding into one field of the holder's state.
    private func bind(_ read: @escaping (RegistrationState) -> String, _ write: @escaping (RegistrationState, String) -> RegistrationState) -> Binding<String> {
        Binding(get: { read(state) }, set: { new in holder.update { write($0, new) } })
    }
}

extension RegistrationState {
    /// A copy with some fields changed (Kotlin's `copy` has no default arguments in Swift).
    func updating(clinicName: String? = nil, city: String? = nil, contactName: String? = nil, email: String? = nil,
                  phone: String? = nil, specialty: Specialty? = nil, message: String? = nil) -> RegistrationState {
        doCopy(
            clinicName: clinicName ?? self.clinicName, city: city ?? self.city, contactName: contactName ?? self.contactName,
            email: email ?? self.email, phone: phone ?? self.phone, specialty: specialty ?? self.specialty,
            message: message ?? self.message, invalid: invalid, sending: sending, error: error, received: received
        )
    }
}
