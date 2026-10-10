import AarogyamShared
import SakalyaUI
import SwiftUI

/// Joining a clinic from an invitation link, in two places: signed out it takes the link (pasted
/// or opened through `aarogyam://invite#...`) and sends the person on to sign in; signed in it
/// accepts the invitation and lands on the clinic list.
struct InviteScreen: View {
    let holder: InviteStateHolder
    let state: InviteState
    /// Signed out: the person still has to sign in; [onContinue] hands the link on and goes there.
    let signedIn: Bool
    let onLink: (String) -> Void
    let onContinue: () -> Void
    let onBack: () -> Void
    @State private var pasted = ""
    @State private var name = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("t7.invite.title", tableName: "TodayV7").font(.system(size: 29, weight: .heavy)).tracking(-0.6)
                    .foregroundStyle(r.onSurface.color).accessibilityAddTraits(.isHeader)
                switch onEnum(of: state) {
                case .needsLink, .badLink: paste(bad: { if case .badLink = onEnum(of: state) { true } else { false } }())
                case .ready: ready
                case .joining: SkLoadingIndicator(String(localized: "t7.invite.joining", table: "TodayV7")).frame(maxWidth: .infinity).padding(.top, 30)
                case .joined: joined
                case .failed(let failed):
                    Text(failed.error.message).skTextStyle(SkTypeScale.body).foregroundStyle(r.error.color)
                    SkPillButton(String(localized: "try_again"), wide: true) { holder.forget() }
                }
            }
            .padding(.horizontal, SkSpacing.xl).padding(.top, 64).padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .topLeading) {
            if !signedIn {
                Button(action: onBack) { V7Icon(name: "back", size: 20).frame(width: 40, height: 40).background(.ultraThinMaterial, in: Circle()) }
                    .buttonStyle(.skPressable).padding(.leading, 12).padding(.top, 6)
                    .accessibilityLabel(String(localized: "t7.back", table: "TodayV7"))
            }
        }
    }

    private func paste(bad: Bool) -> some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 12) {
            Text("t7.invite.message", tableName: "TodayV7").font(.system(size: 15)).foregroundStyle(r.onSurfaceVariant.color)
            SkField(
                String(localized: "t7.invite.link", table: "TodayV7"), text: $pasted, placeholder: "https://…/invite#…",
                error: bad ? String(localized: "t7.invite.bad_link", table: "TodayV7") : nil, keyboard: .URL
            )
            .textInputAutocapitalization(.never).autocorrectionDisabled()
            HStack(spacing: 8) {
                SkPillButton(String(localized: "t7.invite.paste", table: "TodayV7"), variant: .tonal, wide: true) {
                    if let text = UIPasteboard.general.string { pasted = text; useLink(text) }
                }
                SkPillButton(String(localized: "t7.invite.use", table: "TodayV7"), wide: true) { useLink(pasted) }
                    .disabled(pasted.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            Text("t7.invite.where", tableName: "TodayV7").font(.system(size: 12)).foregroundStyle(r.onSurfaceVariant.color)
        }
    }

    private func useLink(_ text: String) {
        holder.useLink(text: text)
        onLink(text)
    }

    private var ready: some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                V7Icon(name: "team", size: 26, tint: r.onPrimaryContainer.color).frame(width: 52, height: 52).background(r.primaryContainer.color, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("t7.invite.ready", tableName: "TodayV7").font(.system(size: 16, weight: .bold)).foregroundStyle(r.onSurface.color)
                    Text(signedIn ? "t7.invite.ready_in" : "t7.invite.ready_out", tableName: "TodayV7")
                        .font(.system(size: 13)).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(r.card.color, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            if signedIn {
                SkField(String(localized: "t7.invite.name", table: "TodayV7"), text: $name, contentType: .name)
                SkPillButton(String(localized: "t7.invite.join", table: "TodayV7"), variant: .warm, wide: true) { holder.accept(displayName: name) }
                SkPillButton(String(localized: "t7.invite.not_now", table: "TodayV7"), variant: .ghost, wide: true, action: onBack)
            } else {
                SkPillButton(String(localized: "t7.invite.sign_in", table: "TodayV7"), wide: true, action: onContinue)
            }
        }
    }

    private var joined: some View {
        VStack(spacing: 14) {
            SkCheckDraw().frame(width: 64, height: 64)
            Text("t7.invite.joined", tableName: "TodayV7").font(.system(size: 20, weight: .heavy)).foregroundStyle(theme.roles.onSurface.color)
            SkPillButton(String(localized: "t7.invite.continue", table: "TodayV7"), wide: true, action: onContinue)
        }
        .frame(maxWidth: .infinity).padding(.top, 24)
    }
}
