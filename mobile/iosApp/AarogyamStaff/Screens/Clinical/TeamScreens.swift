import AarogyamShared
import SakalyaUI
import SwiftUI

/// The team list (`staff.manage`): who is in the clinic, their role and whether they are active.
/// Tapping a person opens (or finds) a direct chat with them when the role may chat.
struct TeamPage: View {
    let holder: TeamStateHolder
    let state: ListState
    let canChat: Bool
    @Binding var path: [MoreRoute]
    @State private var chattingWith = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(spacing: 3) {
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(CL("c.loading")).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(CL("c.team.not_allowed.title"), message: CL("c.team.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(CL("c.team.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    let rows = loaded.items.compactMap { $0 as? MemberRow }
                    if canChat { chatsRow.padding(.bottom, 9) }
                    ForEach(Array(rows.enumerated()), id: \.element.membershipId) { index, row in
                        Button {
                            guard canChat && !row.me else { return }
                            chattingWith = row.name
                            holder.message(membershipId: row.membershipId)
                        } label: {
                            MemberRowView(row: row, chat: canChat && !row.me)
                                .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: rows.count), style: .continuous))
                        }
                        .buttonStyle(.skPressable)
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(CL("c.team.title"))
        .refreshable { holder.refresh() }
        .task {
            for await opened in holder.opened {
                guard let id = opened else { continue }
                holder.consumeOpened()
                path.append(.thread(id: id, title: chattingWith.isEmpty ? CL("c.chat.direct") : chattingWith))
            }
        }
    }

    private var chatsRow: some View {
        Button { path.append(.chats) } label: {
            HStack(spacing: 10) {
                V7Icon(name: "msg", size: 19, tint: theme.roles.onPrimaryContainer.color)
                    .frame(width: 38, height: 38)
                    .background(theme.roles.primaryContainer.color, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                Text("c.chat.open", tableName: "ClinicalV7").font(.system(size: 13.5, weight: .bold)).foregroundStyle(theme.roles.onSurface.color)
                Spacer(minLength: 0)
                V7Icon(name: "chev", size: 18, tint: theme.roles.onSurfaceVariant.color)
            }
            .padding(.vertical, 9).padding(.horizontal, 11)
            .background(theme.roles.card.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.skPressable)
    }
}

private struct MemberRowView: View {
    let row: MemberRow
    let chat: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(spacing: 10) {
            SkAvatar(row.name, tone: row.active ? .brand : .neutral, size: 38, shape: .rounded)
            VStack(alignment: .leading, spacing: 1) {
                Text(row.name).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                Text(row.roleName).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
            }
            Spacer(minLength: 6)
            if row.me { SkChip(CL("c.team.you"), tone: .brand) } else if !row.active { SkChip(CL("c.team.inactive"), tone: .neutral) }
            if chat { V7Icon(name: "msg", size: 18, tint: r.onSurfaceVariant.color) }
        }
        .padding(.vertical, 9).padding(.horizontal, 11)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// The Messages page: booking reminders and escalations from the clinic's inbox, with the way
/// into team chat on top.
struct InboxPage: View {
    let holder: InboxStateHolder
    let state: ListState
    let canChat: Bool
    @Binding var path: [MoreRoute]
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(spacing: 3) {
                if canChat {
                    Button { path.append(.chats) } label: {
                        HStack(spacing: 10) {
                            V7Icon(name: "team", size: 19, tint: r.onPrimaryContainer.color).frame(width: 38, height: 38)
                                .background(r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                            Text("c.chat.open", tableName: "ClinicalV7").font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                            Spacer(minLength: 0)
                            V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color)
                        }
                        .padding(.vertical, 9).padding(.horizontal, 11)
                        .background(r.card.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(.skPressable).padding(.bottom, 9)
                }
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(CL("c.loading")).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(CL("c.inbox.not_allowed.title"), message: CL("c.inbox.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(CL("c.inbox.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    let rows = loaded.items.compactMap { $0 as? AlertRow }
                    if rows.isEmpty { SkEmptyState(CL("c.inbox.empty.title"), message: CL("c.inbox.empty.message")) }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        alert(row).background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: rows.count), style: .continuous))
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(CL("c.inbox.title"))
        .refreshable { holder.refresh() }
    }

    private func alert(_ row: AlertRow) -> some View {
        let r = theme.roles
        return HStack(spacing: 10) {
            V7Icon(name: "msg", size: 19, tint: r.onSurfaceVariant.color)
            VStack(alignment: .leading, spacing: 1) {
                Text(ClinicalFormat.keyText(row.kind)).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                Text(ClinicalFormat.chatTime(row.at)).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
            }
            Spacer(minLength: 6)
            if !row.read { SkChip(CL("c.inbox.new"), tone: .warning) }
        }
        .padding(.vertical, 9).padding(.horizontal, 11)
        .accessibilityElement(children: .combine)
    }
}
