import AarogyamShared
import SakalyaUI
import SwiftUI

/// The patient's open follow-ups on Overview: due date and reason, with Dismiss for one that is no
/// longer needed (`POST /recalls/{id}/dismiss`, after a confirm). Hidden when there are none.
struct V9FollowUpsCard: View {
    let holder: RecallsStateHolder
    let state: RecallsState
    /// `patients.write`: the server's rule for dismissing a follow-up.
    let canDismiss: Bool
    @State private var dismissing: RecallView?
    @Environment(\.skTheme) private var theme

    var body: some View {
        if state.allowed, !state.items.isEmpty || state.error != nil {
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    V9SectionHead(title: p9("p9.followups"), note: state.items.isEmpty ? nil : String(state.items.count))
                    if let error = state.error { V9ErrorLine(error: error) }
                    ForEach(state.items, id: \.id) { row($0) }
                }
            }
            .confirmationDialog(p9("p9.followups.dismiss.confirm"), isPresented: Binding(
                get: { dismissing != nil }, set: { if !$0 { dismissing = nil } }
            ), titleVisibility: .visible, presenting: dismissing) { item in
                Button(p9("p9.followups.dismiss"), role: .destructive) { holder.dismiss(id: item.id, reason: nil) }
            }
        }
    }

    private func row(_ item: RecallView) -> some View {
        let r = theme.roles
        let due = ClinicFormat.date(iso: item.dueOn)
        return HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(String(format: p9("p9.followups.due"), due)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                Text(item.reason).v7Text(14, .semibold).foregroundStyle(r.onSurface.color)
            }
            Spacer(minLength: 8)
            if canDismiss {
                SkPillButton(p9("p9.followups.dismiss"), variant: .ghost) { dismissing = item }
                    .accessibilityLabel(String(format: p9("p9.followups.dismiss.a11y"), due))
            }
        }
        .padding(.vertical, 4)
    }
}
