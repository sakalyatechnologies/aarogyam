import SakalyaUI
import SwiftUI

/// "N online bookings to confirm": opens Schedule's Day view with only those.
struct OnlineBookingsCard: View {
    let count: Int
    let onOpen: () -> Void
    @Environment(\.skTheme) private var theme

    private var title: String {
        count == 1 ? String(localized: "appt.online_one") : String(format: String(localized: "appt.online_many"), count)
    }

    var body: some View {
        Button(action: onOpen) {
            Text(title)
                .skTextStyle(SkTypeScale.body)
                .foregroundStyle(theme.roles.onTertiaryContainer.color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(theme.roles.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.skPressable)
    }
}
