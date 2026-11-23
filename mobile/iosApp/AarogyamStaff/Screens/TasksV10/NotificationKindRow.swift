import AarogyamShared
import SakalyaUI
import SwiftUI

/// One bell row for any kind (Clear Glass): unread dot, a tile tinted by the kind's group, the
/// localized title with the token line, and the time on the right, with a chevron when the row
/// opens a patient. An unknown kind shows the generic title. Unread is weight and dot, never colour alone.
struct NotificationKindRow: View {
    let row: AlertRow
    var now = Date()
    @Environment(\.skTheme) private var theme
    @ScaledMetric(relativeTo: .body) private var tile: CGFloat = 38

    var body: some View {
        let r = theme.roles
        let tint = NotificationKindRow.color(TasksV10.notificationTint(kind: row.kind), r)
        let title = TasksV10.notificationTitle(kind: row.kind)
        let detail = DeskAlert.detail(token: row.tokenNumber?.intValue, number: row.patientNumber, doctor: row.doctor)
        HStack(spacing: 12) {
            Circle().fill(row.read ? Color.clear : r.primary.color).frame(width: 9, height: 9)
                .accessibilityLabel(Text("t7.notif.unread", tableName: "TodayV7"))
                .accessibilityHidden(row.read)
            Image(systemName: symbol)
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: tile * 0.45, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: tile, height: tile)
                .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: tile * 0.29, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(row.read ? .regular : .semibold)).foregroundStyle(r.onSurface.color)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail { Text(detail).font(.footnote).foregroundStyle(r.onSurfaceVariant.color) }
            }
            Spacer(minLength: 4)
            HStack(spacing: 2) {
                if let time = TasksV10.notificationTime(row.at, now: now) {
                    Text(time).font(.footnote).foregroundStyle(r.onSurfaceVariant.color).lineLimit(1)
                }
                if row.patientId != nil {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold))
                        .foregroundStyle(r.onSurfaceVariant.color).accessibilityHidden(true)
                }
            }
        }
        .frame(minHeight: 62)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// Money rows get the rupee; the rest keep the shared icon.
    private var symbol: String {
        TasksV10.notificationTint(kind: row.kind) == .money ? "indianrupeesign" : TasksV10.notificationSymbol(kind: row.kind)
    }

    static func color(_ tint: NotificationTint, _ r: SkRoles) -> Color {
        switch tint {
        case .queue: r.primary.color
        case .money: r.tertiary.color
        case .booking: r.chart3.color
        case .clinical: r.error.color
        case .neutral: r.onSurfaceVariant.color
        }
    }
}
