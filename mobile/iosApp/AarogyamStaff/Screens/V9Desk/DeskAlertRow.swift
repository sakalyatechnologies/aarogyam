import AarogyamShared
import SakalyaUI
import SwiftUI

/// One row of the bell's sheet. Queue alerts (patient waiting, send in, collect payment) get an
/// icon and the token with the clinic number; booking ones keep the existing title.
struct DeskAlertRow: View {
    let row: AlertRow
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let title = DeskAlert.title(row.kind) ?? TodayV7.notificationTitle(kind: row.kind)
        let detail = DeskAlert.detail(token: row.tokenNumber?.intValue, number: row.patientNumber, doctor: row.doctor)
        HStack(spacing: 10) {
            if !row.read { SkBadgeDot() }
            if DeskAlert.isQueue(row.kind) { V7Icon(name: DeskAlert.icon(row.kind), size: 20, tint: r.primary.color) }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(r.onSurface.color)
                if let detail { Text(detail).v7Text(12).foregroundStyle(r.onSurfaceVariant.color) }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
