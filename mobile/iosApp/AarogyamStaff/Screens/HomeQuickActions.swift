import AarogyamShared
import SakalyaUI
import SwiftUI

extension View {
    /// "Patient QR" and "Book" beside the bar's "+" on Home. QR is for everyone (the Book tab); Book starts the same
    /// walk-in search as "+" and needs appointments.write.
    func homeBarIcons(permissions: Set<String>, onBook: @escaping () -> Void, onQR: @escaping () -> Void) -> some View {
        toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: onQR) { Label(String(localized: "home.qr.title"), systemImage: "qrcode") }
                if PatientQr.shared.canBook(permissions: permissions) {
                    Button(action: onBook) { Label(String(localized: "home.book.title"), systemImage: "calendar.badge.plus") }
                }
            }
        }
    }
}
