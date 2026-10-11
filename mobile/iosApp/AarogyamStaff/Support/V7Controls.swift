import SakalyaUI
import SwiftUI

/// A small bold section label inside a sheet (`<b style="font-size:13px;color:var(--on-v)">`).
struct V7Label: View {
    let text: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        Text(text).font(.system(size: 13, weight: .bold)).foregroundStyle(theme.roles.onSurfaceVariant.color)
    }
}
