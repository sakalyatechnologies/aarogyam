import AarogyamShared
import SakalyaUI
import SwiftUI

/// The "Use a password" step of sign-in: the email, a secure password field and a way back to the emailed code.
struct SignInPasswordStep: View {
    let holder: SignInStateHolder
    let state: SignInState
    @FocusState private var passwordFocused: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: 0) {
            Text(s11("store.signin.password_title")).font(.system(size: 29, weight: .heavy)).tracking(-0.6)
                .foregroundStyle(r.onSurface.color).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
                .padding(.bottom, 20)
            SkField(
                String(localized: "sign_in.email_label"), text: Binding(get: { state.email }, set: { holder.onEmailChange(text: $0) }),
                placeholder: "name@clinic.com", error: state.error == .invalidEmail ? state.error?.message : nil,
                contentType: .username, keyboard: .emailAddress
            )
            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.next)
            .onSubmit { passwordFocused = true }
            passwordField(r).padding(.top, 12)
            if let error = state.error, error != .invalidEmail {
                Text(error.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
            }
            SkPillButton(s11("store.signin.sign_in"), wide: true, loading: state.busy) { holder.submitPassword() }.padding(.top, 16)
            Button { holder.useCode() } label: {
                Text(s11("store.signin.use_code")).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.primary.color)
                    .frame(minHeight: 44)
            }
            .padding(.top, 6)
        }
    }

    /// A field in the look of `SkField`, with the characters hidden.
    private func passwordField(_ r: SkRoles) -> some View {
        VStack(alignment: .leading, spacing: SkFieldSizes.gap) {
            Text(s11("store.signin.password_label")).font(.system(size: SkFieldSizes.label, weight: .bold))
                .foregroundStyle(r.onSurfaceVariant.color)
            SecureField("", text: Binding(get: { state.password }, set: { holder.onPasswordChange(text: $0) }))
                .textContentType(.password).textInputAutocapitalization(.never).autocorrectionDisabled()
                .submitLabel(.go).focused($passwordFocused).onSubmit { holder.submitPassword() }
                .font(.system(size: SkFieldSizes.text)).foregroundStyle(r.onSurface.color)
                .padding(.horizontal, SkFieldSizes.paddingH).frame(minHeight: SkFieldSizes.height)
                .background(r.surface3.color, in: RoundedRectangle(cornerRadius: SkFieldSizes.radius, style: .continuous))
                .overlay {
                    if state.error != nil && state.error != .invalidEmail {
                        RoundedRectangle(cornerRadius: SkFieldSizes.radius, style: .continuous).strokeBorder(r.error.color, lineWidth: SkFieldSizes.border)
                    }
                }
                .accessibilityLabel(s11("store.signin.password_label"))
        }
    }
}
