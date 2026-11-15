import AarogyamShared
import SakalyaUI
import SwiftUI

/// The team chat list: groups and direct conversations with unread counts. Refreshed every minute while open.
struct ChatListPage: View {
    let holder: ChatListStateHolder
    let state: ChatListState
    @Binding var path: [MoreRoute]
    @Environment(\.skTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(spacing: 3) {
                if !state.allowed {
                    SkEmptyState(CL("c.chat.not_allowed.title"), message: CL("c.chat.not_allowed.message"))
                } else if let error = state.error, state.rows.isEmpty {
                    SkEmptyState(CL("c.chat.title"), message: error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                } else if state.loading && state.rows.isEmpty {
                    SkLoadingIndicator(CL("c.loading")).padding(SkSpacing.xxl)
                } else if state.rows.isEmpty {
                    SkEmptyState(CL("c.chat.empty.title"), message: CL("c.chat.empty.message"))
                }
                ForEach(Array(state.rows.enumerated()), id: \.element.id) { index, row in
                    Button { path.append(.thread(id: row.id, title: row.title)) } label: {
                        ConversationRowView(row: row)
                            .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: state.rows.count), style: .continuous))
                    }
                    .buttonStyle(.skPressable)
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(CL("c.chat.title"))
        .refreshable { holder.refresh() }
        .task(id: scenePhase) {
            // Polls only while the app is in front.
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                holder.refresh()
            }
        }
    }
}

private struct ConversationRowView: View {
    let row: ConversationRow
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(spacing: 10) {
            if row.group {
                V7Icon(name: "team", size: 19, tint: (row.channel ? r.onPrimary : r.onPrimaryContainer).color).frame(width: 38, height: 38)
                    .background((row.channel ? r.primary : r.primaryContainer).color, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
            } else {
                SkAvatar(row.title, tone: .brand, size: 38, shape: .rounded)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(row.title).font(.system(size: 13.5, weight: row.unread > 0 ? .heavy : .bold)).foregroundStyle(r.onSurface.color)
                Text(row.lastMessageAt.map { ClinicalFormat.chatTime($0) } ?? CL("c.chat.no_messages")).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
            }
            Spacer(minLength: 6)
            if row.muted { V7Icon(name: "bell", size: 16, tint: r.onSurfaceVariant.color).opacity(0.5) }
            if row.unread > 0 {
                Text("\(row.unread)").font(.system(size: 11.5, weight: .heavy)).foregroundStyle(r.onPrimary.color)
                    .padding(.horizontal, 7).frame(minWidth: 22, minHeight: 22)
                    .background(r.primary.color, in: Capsule())
            }
        }
        .padding(.vertical, 9).padding(.horizontal, 11)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(row.unread > 0 ? CLf("c.chat.unread.a11y", row.title, Int(row.unread)) : row.title)
    }
}
