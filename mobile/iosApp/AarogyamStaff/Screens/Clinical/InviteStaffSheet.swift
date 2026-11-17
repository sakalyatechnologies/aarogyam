import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Invite to the team": an email and a role, then Send invitation; the server emails the sign-in code.
struct InviteStaffSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let onDone: (_ sent: Bool) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScreenHost(make: { graph.inviteStaff(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    SkSheetHeader(CL("c.team.invite_title"))
                    if let sent = state.sentTo {
                        sentView(holder, sent)
                    } else {
                        form(holder, state)
                    }
                }
                .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
            }
            .skSheet()
        }
    }

    @ViewBuilder private func form(_ holder: InviteStaffStateHolder, _ state: StaffInviteState) -> some View {
        let r = theme.roles
        Text(CL("c.team.invite_hint")).v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
        SkField(
            CL("c.team.invite_email"),
            text: Binding(get: { state.email }, set: { holder.setEmail(text: $0) }),
            placeholder: "name@example.com",
            error: state.emailInvalid ? CL("c.team.invite_email_invalid") : nil,
            contentType: .emailAddress,
            keyboard: .emailAddress
        )
        Text(CL("c.team.invite_role")).v7Text(12.5, .bold).foregroundStyle(r.onSurfaceVariant.color)
        FlowLayout(spacing: 8) {
            ForEach(state.roles, id: \.key) { role in
                SkChoiceChip(role.name, selected: state.roleKey == role.key) { holder.chooseRole(key: role.key) }
            }
        }
        if let error = state.error {
            Text(error.message).v7Text(12.5).foregroundStyle(r.error.color)
        }
        SkPillButton(CL("c.team.invite_send"), wide: true, loading: state.sending || state.loadingRoles) { holder.send() }
            .disabled(!state.canSend)
    }

    @ViewBuilder private func sentView(_ holder: InviteStaffStateHolder, _ sent: String) -> some View {
        let r = theme.roles
        SkCheckDraw().frame(width: 64, height: 64).frame(maxWidth: .infinity)
        Text(String(format: CL("c.team.invite_sent %@"), sent)).v7Text(17, .heavy).foregroundStyle(r.onSurface.color)
        Text(CL("c.team.invite_hint")).v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
        SkPillButton(CL("c.team.invite_another"), variant: .tonal, wide: true) { holder.another() }
        SkPillButton(String(localized: "done"), wide: true) { onDone(true) }
    }
}
