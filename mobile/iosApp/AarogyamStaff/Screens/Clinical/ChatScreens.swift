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
                V7Icon(name: "team", size: 19, tint: r.onPrimaryContainer.color).frame(width: 38, height: 38)
                    .background(r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
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

/// One conversation: bubbles (mine on the right), pending and failed ones marked, a composer.
/// While it is open the thread polls every few seconds for newer messages.
struct ChatThreadPage: View {
    let holder: ChatThreadStateHolder
    let state: ThreadState
    @Environment(\.skTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let r = theme.roles
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if state.loading && state.messages.isEmpty {
                            SkLoadingIndicator(CL("c.loading")).padding(SkSpacing.xxl)
                        } else if let error = state.error, state.messages.isEmpty {
                            SkEmptyState(CL("c.chat.title"), message: error.message)
                        } else if state.messages.isEmpty {
                            Text("c.chat.thread.empty", tableName: "ClinicalV7").font(.system(size: 13)).foregroundStyle(r.onSurfaceVariant.color).padding(SkSpacing.xxl)
                        }
                        ForEach(state.messages, id: \.clientId) { message in
                            Bubble(message: message) { holder.retry(clientId: message.clientId) }.id(message.clientId)
                        }
                    }
                    .padding(.horizontal, SkSpacing.l).padding(.vertical, SkSpacing.m)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: state.messages.count) { _, _ in
                    if let last = state.messages.last { withAnimation { proxy.scrollTo(last.clientId, anchor: .bottom) } }
                }
            }
            composer
        }
        .background(r.background.color)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: scenePhase) {
            // Polls only while the app is in front.
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                holder.poll()
            }
        }
    }

    private var composer: some View {
        let r = theme.roles
        let empty = state.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return HStack(alignment: .bottom, spacing: SkSpacing.sm) {
            TextField(CL("c.chat.compose"), text: Binding(get: { state.draft }, set: { holder.setDraft(text: $0) }), axis: .vertical)
                .font(.system(size: 15)).lineLimit(1...5)
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(r.surface3.color, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            Button { holder.send() } label: {
                Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold))
                    .foregroundStyle(r.onPrimary.color).frame(width: 44, height: 44)
                    .background((empty ? r.surface3 : r.primary).color, in: Circle())
            }
            .disabled(empty)
            .accessibilityLabel(CL("c.chat.send"))
        }
        .padding(.horizontal, SkSpacing.l).padding(.vertical, SkSpacing.sm)
        .background(r.background.color)
    }
}

private struct Bubble: View {
    let message: MessageView
    let onRetry: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let ink = (message.mine ? r.onPrimary : r.onSurface).color
        HStack {
            if message.mine { Spacer(minLength: 56) }
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 2) {
                if !message.mine, let author = message.author {
                    Text(author).font(.system(size: 11, weight: .bold)).foregroundStyle(r.onSurfaceVariant.color)
                }
                Text(message.deleted ? CL("c.chat.deleted") : message.body ?? "")
                    .font(.system(size: 15)).italic(message.deleted).foregroundStyle(ink)
                    .padding(.horizontal, 13).padding(.vertical, 9)
                    .background((message.mine ? r.primary : r.card).color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .opacity(message.pending ? 0.6 : 1)
                if message.failed {
                    Button(action: onRetry) {
                        Text("c.chat.failed", tableName: "ClinicalV7").font(.system(size: 11.5, weight: .bold)).foregroundStyle(r.error.color).frame(minHeight: 32)
                    }
                } else if message.pending {
                    Text("c.chat.sending", tableName: "ClinicalV7").font(.system(size: 11)).foregroundStyle(r.onSurfaceVariant.color)
                } else if !message.at.isEmpty {
                    Text(ClinicalFormat.chatTime(message.at)).font(.system(size: 10.5)).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            if !message.mine { Spacer(minLength: 56) }
        }
        .accessibilityElement(children: .combine)
    }
}
