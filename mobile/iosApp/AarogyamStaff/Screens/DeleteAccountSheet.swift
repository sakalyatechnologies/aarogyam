import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Delete account" from More: what is deleted, what stays with the clinic, then a confirmed delete.
/// On success the session ends and the app returns to sign-in on its own.
struct DeleteAccountSheet: View {
    let graph: AppGraph
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScreenHost(make: { graph.deleteAccount(screen: $0) }, state: { $0.state }) { holder, state in
            DeleteAccountContent(holder: holder, state: state) { dismiss() }
        }
        .skSheet()
        .presentationDetents([.medium, .large])
    }
}

private struct DeleteAccountContent: View {
    let holder: DeleteAccountHolder
    let state: DeleteAccountState
    let close: () -> Void
    @State private var confirming = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            Text(s11("store.delete.title")).skTextStyle(SkTypeScale.title).foregroundStyle(r.onSurface.color)
                .accessibilityAddTraits(.isHeader)
            Text(s11("store.delete.body")).skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
            Text(s11("store.delete.unsent")).skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
            if let notice { Text(notice).skTextStyle(SkTypeScale.footnote).fontWeight(.bold).foregroundStyle(r.error.color) }
            Spacer(minLength: 0)
            Button { confirming = true } label: {
                Text(s11("store.delete.button")).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(r.error.color, in: Capsule())
            }
            .buttonStyle(.skPressable).disabled(busy).opacity(busy ? 0.5 : 1)
            Button(action: close) {
                Text(s11("store.delete.close")).font(.system(size: 14, weight: .bold)).foregroundStyle(r.primary.color)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .padding(SkSpacing.l)
        .confirmationDialog(s11("store.delete.confirm_title"), isPresented: $confirming, titleVisibility: .visible) {
            Button(s11("store.delete.button"), role: .destructive) { holder.delete() }
            Button(s11("store.delete.cancel"), role: .cancel) {}
        } message: {
            Text(s11("store.delete.unsent"))
        }
    }

    private var busy: Bool {
        if case .deleting = onEnum(of: state) { return true }
        return false
    }

    /// The refusal or error under the explanation, or nil while there is none.
    private var notice: String? {
        switch onEnum(of: state) {
        case .lastOwner(let owner): s11f("store.delete.last_owner", owner.clinicNames.joined(separator: ", "))
        case .platformStaff: s11("store.delete.platform")
        case .notStaff: s11("store.delete.no_staff")
        case .failed(let failed): failed.error.message
        case .idle, .deleting, .deleted: nil
        }
    }
}
