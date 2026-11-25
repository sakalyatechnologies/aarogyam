import AarogyamShared
import SakalyaUI
import SwiftUI

/// Self check-in settings (settings.manage): the switch, the patients' QR with Share, and a new key.
struct SelfCheckInSheet: View {
    let holder: SelfCheckInHolder
    let state: SelfCheckInState
    let clinicName: String
    @State private var confirming = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        SkSheetScaffold(String(localized: "selfcheckin.title"), subtitle: clinicName) {
            switch onEnum(of: state) {
            case .loading, .notAllowed:
                ProgressView().frame(maxWidth: .infinity)
            case .failed(let failed):
                VStack(spacing: 10) {
                    Text(failed.error.message).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.error.color)
                    SkPillButton(String(localized: "try_again"), variant: .tonal) { holder.load() }
                }
            case .loaded(let loaded):
                content(loaded)
            }
        }
        .skSheet()
        .alert(String(localized: "selfcheckin.new_key.title"), isPresented: $confirming) {
            Button(String(localized: "selfcheckin.new_key"), role: .destructive) { holder.regenerateKey() }
            Button(String(localized: "selfcheckin.cancel"), role: .cancel) {}
        } message: {
            Text("selfcheckin.new_key.body")
        }
    }

    @ViewBuilder private func content(_ loaded: SelfCheckInStateLoaded) -> some View {
        let r = theme.roles
        VStack(spacing: 14) {
            Toggle(isOn: Binding(get: { loaded.enabled }, set: { holder.setEnabled(on: $0) })) {
                Text("selfcheckin.switch").font(.body.weight(.semibold)).foregroundStyle(r.onSurface.color)
            }
            .tint(r.primary.color).disabled(loaded.saving)
            Text("selfcheckin.message").font(.footnote).foregroundStyle(r.onSurfaceVariant.color).frame(maxWidth: .infinity, alignment: .leading)
            if let error = loaded.error {
                Text(error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
            }
            if loaded.enabled, let url = loaded.url, let image = QRCode.image(for: url) {
                Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                    .frame(maxWidth: 240).padding(16).background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .accessibilityLabel(String(localized: "selfcheckin.code"))
                HStack(spacing: 8) {
                    if let link = URL(string: url) {
                        ShareLink(item: link) {
                            Text("selfcheckin.share").font(.system(size: 14, weight: .bold)).foregroundStyle(r.onPrimary.color)
                                .frame(maxWidth: .infinity, minHeight: 46).background(r.primary.color, in: Capsule())
                        }
                    }
                    SkPillButton(String(localized: "selfcheckin.new_key"), variant: .tonal, wide: true) { confirming = true }.disabled(loaded.saving)
                }
            } else if !loaded.enabled {
                Text("selfcheckin.off").font(.footnote).foregroundStyle(r.onSurfaceVariant.color)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
