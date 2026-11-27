import AarogyamShared
import SakalyaUI
import SwiftUI

/// Mockup (not merged): where the patient QR and "Book appointment" live on Home. A puts them in the top bar,
/// B in a row of two tiles above the Home content. `AAROGYAM_DEV_HOME_VARIANT=A|B` picks one in debug builds.
enum HomeVariant {
    case barIcons, actionRow, off

    static var current: HomeVariant {
        #if DEBUG && AARO_ENV_Local
        switch ProcessInfo.processInfo.environment["AAROGYAM_DEV_HOME_VARIANT"] {
        case "B": return .actionRow
        case "today": return .off
        default: break
        }
        #endif
        return .barIcons
    }

    /// The same gate as the More tile: settings.manage.
    static func showsQR(_ permissions: Set<String>) -> Bool {
        #if DEBUG && AARO_ENV_Local
        // Mockup shots only: show the entry to a role without the permission, to see where it would sit.
        if ProcessInfo.processInfo.environment["AAROGYAM_DEV_HOME_QR"] == "all" { return true }
        #endif
        return permissions.contains("settings.manage")
    }
    /// Booking starts in the "+" search, which needs appointments.write.
    static func showsBook(_ permissions: Set<String>) -> Bool { permissions.contains("appointments.write") }
}

/// Variant B: two large tiles at the very top of Home.
struct HomeActionRow: View {
    let permissions: Set<String>
    let onBook: () -> Void
    let onQR: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            if HomeVariant.showsBook(permissions) {
                tile(icon: "cal", title: "home.book.tile", sub: "home.book.tile.sub", warm: false, action: onBook)
            }
            if HomeVariant.showsQR(permissions) {
                tile(icon: "qr", title: "home.qr.tile", sub: "home.qr.tile.sub", warm: true, action: onQR)
            }
        }
        .padding(.horizontal, SkSpacing.l).padding(.top, SkSpacing.s).padding(.bottom, SkSpacing.xs)
    }

    private func tile(icon: String, title: LocalizedStringKey, sub: LocalizedStringKey, warm: Bool, action: @escaping () -> Void) -> some View {
        let r = theme.roles
        return Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                V7Icon(name: icon, size: 20, tint: (warm ? r.onTertiaryContainer : r.onPrimaryContainer).color)
                    .frame(width: 38, height: 38)
                    .background((warm ? r.tertiaryContainer : r.primaryContainer).color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.system(size: 15, weight: .bold)).foregroundStyle(r.onSurface.color).lineLimit(2)
                    Text(sub).font(.system(size: 12, weight: .medium)).foregroundStyle(r.onSurfaceVariant.color).lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(r.card.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
        }
        .buttonStyle(.skPressable)
    }
}

extension View {
    /// Variant A: "Patient QR" and "Book" beside the bar's "+".
    @ViewBuilder func homeBarIcons(permissions: Set<String>, onBook: @escaping () -> Void, onQR: @escaping () -> Void) -> some View {
        if HomeVariant.current == .barIcons {
            toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if HomeVariant.showsQR(permissions) {
                        Button(action: onQR) { Label(String(localized: "home.qr.title"), systemImage: "qrcode") }
                    }
                    if HomeVariant.showsBook(permissions) {
                        Button(action: onBook) { Label(String(localized: "home.book.title"), systemImage: "calendar.badge.plus") }
                    }
                }
            }
        } else {
            self
        }
    }
}
