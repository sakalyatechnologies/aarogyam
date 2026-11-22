import AarogyamShared
import SakalyaUI
import SwiftUI

/// The bell's sheet (Clear Glass): the system glass sheet with Close and Read all in the toolbar,
/// a segmented filter, and the rows grouped into Today and Earlier on calm grouped cards. Everything
/// comes from the row's kind, read flag and time; there is no per-row mark-read on the server.
struct NotificationsSheet: View {
    let holder: NotificationsStateHolder
    let state: ListState
    /// A row about one patient (a plan reply) opens them; the sheet closes first.
    var onOpenPatient: (String) -> Void = { _ in }
    @State private var filter = NotificationFilter.all
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    private var rows: [AlertRow] {
        if case .loaded(let loaded) = onEnum(of: state) { Array(loaded.items.compactMap { $0 as? AlertRow }.prefix(30)) } else { [] }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) { content }
                    .padding(.horizontal, SkSpacing.l).padding(.bottom, SkSpacing.xxl)
            }
            .scrollBounceBehavior(.basedOnSize)
            .navigationTitle(String(localized: "t7.notifications", table: "TodayV7"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
        }
        .skGlassSheet()
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button { dismiss() } label: { Image(systemName: "xmark") }
                .accessibilityLabel(a11("a11.close"))
                .accessibilityIdentifier("sheet.close")
        }
        if rows.contains(where: { !$0.read }) {
            ToolbarItem(placement: .topBarTrailing) {
                Button { holder.readAll() } label: {
                    Label { Text("t7.notif.read_all_short", tableName: "TodayV7") } icon: { Image(systemName: "checkmark.circle") }
                        .labelStyle(.titleAndIcon)
                }
                .tint(theme.roles.primary.color)
                .accessibilityLabel(String(localized: "t7.notifications.read_all", table: "TodayV7"))
            }
        }
    }

    @ViewBuilder private var content: some View {
        let r = theme.roles
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(.top, SkSpacing.xl)
        case .notAllowed:
            Text("today.not_allowed.message").font(.footnote).foregroundStyle(r.onSurfaceVariant.color).padding(.top, SkSpacing.l)
        case .failed(let failed):
            Text(failed.error.message).font(.footnote).foregroundStyle(r.error.color).padding(.top, SkSpacing.l)
        case .loaded:
            if rows.isEmpty {
                Text("t7.notifications.none", tableName: "TodayV7").font(.body).foregroundStyle(r.onSurfaceVariant.color)
                    .padding(.top, SkSpacing.l)
            } else {
                filterPicker.padding(.top, SkSpacing.s)
                grouped(rows.filter { TasksV10.matches(filter, kind: $0.kind, read: $0.read) })
            }
        }
    }

    private var filterPicker: some View {
        let unread = rows.filter { !$0.read }.count
        return Picker(selection: $filter) {
            ForEach(NotificationFilter.allCases, id: \.self) { option in
                Text(NotificationsSheet.label(option, unread: unread)).tag(option)
            }
        } label: {
            Text("t7.notif.filter", tableName: "TodayV7")
        }
        .pickerStyle(.segmented)
    }

    @ViewBuilder private func grouped(_ shown: [AlertRow]) -> some View {
        let now = Date()
        let today = shown.filter { TasksV10.isToday($0.at, now: now) }
        let earlier = shown.filter { !TasksV10.isToday($0.at, now: now) }
        if shown.isEmpty {
            Text("t7.notif.filter.empty", tableName: "TodayV7").font(.callout).foregroundStyle(theme.roles.onSurfaceVariant.color)
                .frame(maxWidth: .infinity).padding(.top, SkSpacing.xl)
        }
        if !today.isEmpty {
            GroupedHeader(String(localized: "t7.notif.today", table: "TodayV7"))
            GroupedRows(items: today, inset: NotificationsSheet.inset) { cell($0, now: now) }
        }
        if !earlier.isEmpty {
            GroupedHeader(String(localized: "t7.notif.earlier", table: "TodayV7"))
            GroupedRows(items: earlier, inset: NotificationsSheet.inset) { cell($0, now: now) }
        }
    }

    @ViewBuilder private func cell(_ row: AlertRow, now: Date) -> some View {
        if let patient = row.patientId {
            Button { onOpenPatient(patient) } label: { NotificationKindRow(row: row, now: now).padding(.horizontal, GroupedSizes.rowPaddingH) }
                .buttonStyle(.plain)
        } else {
            NotificationKindRow(row: row, now: now).padding(.horizontal, GroupedSizes.rowPaddingH)
        }
    }

    /// Separators start at the title: padding, the dot, the tile and their gaps.
    private static let inset: CGFloat = GroupedSizes.rowPaddingH + 9 + 12 + 38 + 12

    static func label(_ filter: NotificationFilter, unread: Int) -> String {
        switch filter {
        case .all: String(localized: "t7.notif.filter.all", table: "TodayV7")
        case .unread: unread > 0
            ? String(format: String(localized: "t7.notif.filter.unread_count", table: "TodayV7"), unread)
            : String(localized: "t7.notif.filter.unread", table: "TodayV7")
        case .queue: String(localized: "t7.notif.filter.queue", table: "TodayV7")
        case .bookings: String(localized: "t7.notif.filter.bookings", table: "TodayV7")
        }
    }
}
