import AarogyamShared
import SakalyaUI
import SwiftUI

/// Sign-in in the v7 look: a lock in a morphing blob, the email field, then the emailed code in
/// separate boxes. Apple and Google sign-in are previews (the server has neither).
struct SignInV7Screen: View {
    let holder: SignInStateHolder
    let state: SignInState
    /// An invitation is waiting: the person signs in, then joins.
    var hasInvite = false
    let onBack: () -> Void
    let onRegister: () -> Void
    let onInvite: () -> Void
    @FocusState private var focused: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(spacing: 0) {
                ZStack {
                    SignInBlob()
                    V7Icon(name: "lock", size: 44, tint: .white)
                }
                .frame(width: 110, height: 110).padding(.top, 8).padding(.bottom, 18)
                switch state.step {
                case .email: emailStep(r)
                case .code: codeStep(r)
                }
            }
            .padding(.horizontal, SkSpacing.xl)
            .padding(.top, 56)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .topLeading) {
            Button(action: state.step == .code ? holder.changeEmail : onBack) {
                V7Icon(name: "back", size: 20).frame(width: 40, height: 40).background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.skPressable).padding(.leading, 12).padding(.top, 6)
            .accessibilityLabel(String(localized: "t7.back", table: "TodayV7"))
        }
    }

    private func emailStep(_ r: SkRoles) -> some View {
        VStack(spacing: 0) {
            if hasInvite { InviteBanner() }
            Text("t7.signin.title", tableName: "TodayV7").font(.system(size: 29, weight: .heavy)).tracking(-0.6)
                .foregroundStyle(r.onSurface.color).multilineTextAlignment(.center).accessibilityAddTraits(.isHeader)
            Text("t7.signin.subtitle", tableName: "TodayV7").font(.system(size: 15)).foregroundStyle(r.onSurfaceVariant.color)
                .multilineTextAlignment(.center).padding(.top, 6).padding(.bottom, 20)
            SkField(
                String(localized: "sign_in.email_label"), text: Binding(get: { state.email }, set: { holder.onEmailChange(text: $0) }),
                placeholder: "name@clinic.com", error: state.error?.message, contentType: .username, keyboard: .emailAddress
            )
            .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.send)
            .focused($focused).onSubmit { holder.submitEmail() }
            SkPillButton(String(localized: "sign_in.send_code"), wide: true, loading: state.busy) { holder.submitEmail() }.padding(.top, 12)
            Text("t7.signin.or", tableName: "TodayV7").font(.system(size: 12.5)).foregroundStyle(r.onSurfaceVariant.color).padding(.vertical, 16)
            PreviewNotice(text: String(localized: "t7.signin.sso_preview", table: "TodayV7"))
            VStack(spacing: 4) {
                Text("t7.signin.new_clinic", tableName: "TodayV7").font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color)
                HStack(spacing: 14) {
                    Button(action: onRegister) { Text("t7.signin.request", tableName: "TodayV7").fontWeight(.bold).foregroundStyle(r.primary.color) }
                    Button(action: onInvite) { Text("t7.signin.have_invite", tableName: "TodayV7").fontWeight(.bold).foregroundStyle(r.primary.color) }
                }
                .font(.system(size: 12.5))
            }
            .padding(.top, 18)
        }
    }

    private func codeStep(_ r: SkRoles) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("t7.code.title", tableName: "TodayV7").font(.system(size: 29, weight: .heavy)).tracking(-0.6)
                .foregroundStyle(r.onSurface.color).frame(maxWidth: .infinity).accessibilityAddTraits(.isHeader)
            Text(String(format: String(localized: "sign_in.code_sent"), state.email)).font(.system(size: 14))
                .foregroundStyle(r.onSurfaceVariant.color).padding(.top, 6).padding(.bottom, 18)
            OtpBoxes(count: 8, code: Binding(get: { state.code }, set: { holder.onCodeChange(text: $0) })) { holder.submitCode() }
            if let message = state.error?.message {
                Text(message).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color).padding(.top, 10)
            }
            SkPillButton(String(localized: "sign_in.verify"), wide: true, loading: state.busy) { holder.submitCode() }.padding(.top, 16)
            Text("t7.code.hint", tableName: "TodayV7").font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color)
                .frame(maxWidth: .infinity).multilineTextAlignment(.center).padding(.top, 14)
        }
    }
}

/// The lock's blob: the brand gradient, slowly morphing.
private struct SignInBlob: View {
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let r = theme.roles
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate * 1000 / 9000
            SkBlobShape(SkBlobRadii.morph(t - t.rounded(.down)))
                .fill(LinearGradient(colors: [r.primary.color, r.primary2.color], startPoint: UnitPoint(x: 0.2, y: 0), endPoint: UnitPoint(x: 0.8, y: 1)))
        }
        .accessibilityHidden(true)
    }
}

/// "Your invitation is ready": shown over sign-in while a link is held.
private struct InviteBanner: View {
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(spacing: 8) {
            V7Icon(name: "team", size: 18, tint: r.onTertiaryContainer.color)
            Text("t7.invite.ready_out", tableName: "TodayV7").font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.onTertiaryContainer.color)
        }
        .padding(.horizontal, 12).padding(.vertical, 8).background(r.tertiaryContainer.color, in: Capsule()).padding(.bottom, 14)
    }
}
