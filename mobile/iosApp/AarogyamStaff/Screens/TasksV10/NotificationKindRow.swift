import AarogyamShared
import SakalyaUI
import SwiftUI

/// One bell row for any kind: the shared icon, the localized title and, for queue kinds, the token line.
/// An unknown kind shows the generic title.
struct NotificationKindRow: View {
    let row: AlertRow
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let title = TasksV10.notificationTitle(kind: row.kind)
        let detail = DeskAlert.detail(token: row.tokenNumber?.intValue, number: row.patientNumber, doctor: row.doctor)
        HStack(spacing: 10) {
            if !row.read { SkBadgeDot() }
            Image(systemName: TasksV10.notificationSymbol(kind: row.kind))
                .foregroundStyle(r.primary.color).frame(width: 24).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(r.onSurface.color)
                if let detail { Text(detail).v7Text(12).foregroundStyle(r.onSurfaceVariant.color) }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
