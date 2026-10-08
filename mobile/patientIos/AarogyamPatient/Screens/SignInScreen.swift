import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Email, then the emailed code.
struct SignInScreen: View {
    let holder: SignInStateHolder
    let state: SignInState
    @Environment(\.skTheme) private var theme
    @FocusState private var focused: Bool

    var body: some View {
        let p = theme.palette
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.xs) {
                Text("app_name").skTextStyle(SkTypeScale.overline).foregroundStyle(p.primaryText.color)
                Text("sign_in.title").skTextStyle(SkTypeScale.largeTitle).foregroundStyle(p.text.color)
                    .accessibilityAddTraits(.isHeader)
                Text("sign_in.subtitle").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                    .padding(.bottom, SkSpacing.xl)
                SkCard {
                    VStack(alignment: .leading, spacing: SkSpacing.ml) {
                        switch state.step {
                        case .email: emailStep
                        case .code: codeStep
                        }
                    }
                }
            }
            .padding(SkSpacing.xl)
            .padding(.top, SkSpacing.xxxl * 2)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { focused = true }
    }

    private var error: String? { state.error?.message }

    @ViewBuilder private var emailStep: some View {
        SkTextField(
            String(localized: "sign_in.email_label"),
            text: Binding(get: { state.email }, set: { holder.onEmailChange(text: $0) }),
            message: error,
            isError: error != nil
        )
        .textContentType(.username)
        .keyboardType(.emailAddress)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .submitLabel(.send)
        .focused($focused)
        .onSubmit { holder.submitEmail() }
        SkButton(String(localized: "sign_in.send_code"), action: holder.submitEmail)
            .disabled(state.busy)
    }

    @ViewBuilder private var codeStep: some View {
        Text(String(format: String(localized: "sign_in.code_sent"), state.email))
            .skTextStyle(SkTypeScale.body)
            .foregroundStyle(theme.palette.text.color)
        SkTextField(
            String(localized: "sign_in.code_label"),
            text: Binding(get: { state.code }, set: { holder.onCodeChange(text: $0) }),
            message: error,
            isError: error != nil
        )
        .textContentType(.oneTimeCode)
        .keyboardType(.numberPad)
        .focused($focused)
        SkButton(String(localized: "sign_in.verify"), action: holder.submitCode)
            .disabled(state.busy)
        SkButton(String(localized: "sign_in.change_email"), variant: .secondary, action: holder.changeEmail)
            .disabled(state.busy)
    }
}
