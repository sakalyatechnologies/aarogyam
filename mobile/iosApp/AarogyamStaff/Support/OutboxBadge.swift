import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Saved, will send · N": shows while writes saved on this phone wait for the network. Any screen
/// can place it; it draws nothing when the queue is empty. Reads the app's one outbox.
struct OutboxBadge: View {
    let graph: AppGraph
    @State private var pending = 0
    @Environment(\.skTheme) private var theme

    var body: some View {
        Group {
            if pending > 0 {
                HStack(spacing: 6) {
                    V7Icon(name: "clock", size: 16, tint: theme.roles.onTertiaryContainer.color)
                    Text(String(format: String(localized: "outbox.badge"), pending)).v7Text(13, .bold)
                }
                .foregroundStyle(theme.roles.onTertiaryContainer.color)
                .padding(.horizontal, 12).frame(minHeight: 32)
                .background(theme.roles.tertiaryContainer.color, in: Capsule())
                .accessibilityElement(children: .combine)
            }
        }
        .task { for await next in graph.outbox.pending { pending = Int(truncating: next) } }
    }
}
