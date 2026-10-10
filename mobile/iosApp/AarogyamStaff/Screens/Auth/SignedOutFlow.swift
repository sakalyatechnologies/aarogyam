import AarogyamShared
import SakalyaUI
import SwiftUI

/// What a signed-out person walks through: the welcome pager, then sign-in, registration or the
/// invitation. Each step swaps in with a crossfade and a slight scale (the iOS root swap).
struct SignedOutFlow: View {
    enum Step: Hashable { case welcome, signIn, register, invite }

    let graph: AppGraph
    let app: AppModel
    @State private var step: Step

    init(graph: AppGraph, app: AppModel) {
        self.graph = graph
        self.app = app
        _step = State(initialValue: Self.firstStep(hasInvite: app.pendingInvite != nil))
    }

    /// A pending invitation (opened from a link) goes straight to sign-in.
    static func firstStep(hasInvite: Bool, dev: String? = nil) -> Step {
        #if DEBUG && AARO_ENV_Local
        switch ProcessInfo.processInfo.environment["AAROGYAM_DEV_STEP"] {
        case "signin", "code": return .signIn
        case "register": return .register
        case "invite": return .invite
        default: break
        }
        #endif
        return hasInvite ? .signIn : .welcome
    }

    var body: some View {
        ZStack {
            switch step {
            case .welcome:
                WelcomeScreen(onGetStarted: { go(.signIn) }, onInvite: { go(.invite) })
            case .signIn:
                ScreenHost(make: { graph.signIn(screen: $0) }, state: { $0.state }) { holder, state in
                    SignInV7Screen(
                        holder: holder, state: shown(state), hasInvite: app.pendingInvite != nil,
                        onBack: { go(.welcome) }, onRegister: { go(.register) }, onInvite: { go(.invite) }
                    )
                }
            case .register:
                ScreenHost(make: { graph.registration(screen: $0) }, state: { $0.state }) { holder, state in
                    RegistrationScreen(holder: holder, state: state) { go(.signIn) }
                }
            case .invite:
                ScreenHost(make: { graph.invite(link: app.pendingInvite, screen: $0) }, state: { $0.state }) { holder, state in
                    InviteScreen(
                        holder: holder, state: state, signedIn: false, onLink: { app.pendingInvite = $0 },
                        onContinue: { go(.signIn) }, onBack: { go(.welcome) }
                    )
                }
            }
        }
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }

    private func go(_ next: Step) {
        withAnimation(SkMotionTokens.emphasized.animation(duration: 0.3)) { step = next }
    }

    /// Screenshot runs can show the code step without sending an email.
    private func shown(_ state: SignInState) -> SignInState {
        #if DEBUG && AARO_ENV_Local
        if ProcessInfo.processInfo.environment["AAROGYAM_DEV_STEP"] == "code" {
            return SignInState(step: .code, email: "asha@sunrise.example", code: "482", busy: false, error: nil)
        }
        #endif
        return state
    }
}
