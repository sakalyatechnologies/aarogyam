import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Patient QR": one sheet for the two codes patients scan. Check in is the self check-in code (settings.manage today);
/// Book appointment is the clinic's public booking page. A single allowed tab shows without the control.
struct PatientQRSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var tab: PatientQrTab
    @Environment(\.skTheme) private var theme

    init(graph: AppGraph, clinic: ClinicContext, start: PatientQrTab) {
        self.graph = graph
        self.clinic = clinic
        _tab = State(initialValue: PatientQr.shared.initial(permissions: clinic.permissions, wanted: start))
    }

    private var tabs: [PatientQrTab] { PatientQr.shared.tabs(permissions: clinic.permissions) }

    var body: some View {
        SkSheetScaffold(String(localized: "home.qr.title"), subtitle: clinic.session.clinic.name) {
            VStack(spacing: 14) {
                if tabs.count > 1 {
                    Picker(String(localized: "pqr.tabs"), selection: $tab) {
                        ForEach(tabs, id: \.self) { Text(label($0)) }
                    }
                    .pickerStyle(.segmented)
                }
                switch tab {
                case .checkIn:
                    ScreenHost(make: { graph.selfCheckIn(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                        CheckInQRTab(holder: holder, state: state, clinicName: clinic.session.clinic.name,
                                     canManage: PatientQr.shared.canManageCheckInQr(permissions: clinic.permissions))
                    }
                case .book:
                    BookQRTab(url: TodayV7.bookingURL(origin: clinic.api.origin), clinicName: clinic.session.clinic.name)
                }
            }
        }
        .skSheet()
    }

    private func label(_ tab: PatientQrTab) -> String {
        switch tab {
        case .checkIn: String(localized: "pqr.tab.checkin")
        case .book: String(localized: "pqr.tab.book")
        }
    }
}

/// The white tile a QR sits on.
private struct QRTile: View {
    let image: UIImage
    let label: String
    var body: some View {
        Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
            .frame(maxWidth: 240).padding(16).background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .accessibilityLabel(label)
    }
}

private struct PosterButton: View {
    let url: String
    let clinicName: String
    let caption: String
    var body: some View {
        SkPillButton(String(localized: "pqr.print"), variant: .tonal, wide: true) {
            PosterPrinter.print(url: url, clinicName: clinicName, caption: caption)
        }
    }
}

/// Check in: the self check-in code. The switch and "Make a new QR" are for settings.manage only.
private struct CheckInQRTab: View {
    let holder: SelfCheckInHolder
    let state: SelfCheckInState
    let clinicName: String
    let canManage: Bool
    @State private var confirming = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: 14) {
            Text("pqr.checkin.about").font(.footnote).foregroundStyle(r.onSurfaceVariant.color).frame(maxWidth: .infinity, alignment: .leading)
            switch onEnum(of: state) {
            case .loading, .notAllowed:
                ProgressView().frame(maxWidth: .infinity)
            case .failed(let failed):
                Text(failed.error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                SkPillButton(String(localized: "try_again"), variant: .tonal) { holder.load() }
            case .loaded(let loaded):
                content(loaded)
            }
        }
        .frame(maxWidth: .infinity)
        .alert(String(localized: "selfcheckin.new_key.title"), isPresented: $confirming) {
            Button(String(localized: "selfcheckin.new_key"), role: .destructive) { holder.regenerateKey() }
            Button(String(localized: "selfcheckin.cancel"), role: .cancel) {}
        } message: {
            Text("selfcheckin.new_key.body")
        }
    }

    @ViewBuilder private func content(_ loaded: SelfCheckInStateLoaded) -> some View {
        let r = theme.roles
        if canManage {
            Toggle(isOn: Binding(get: { loaded.enabled }, set: { holder.setEnabled(on: $0) })) {
                Text("selfcheckin.switch").font(.body.weight(.semibold)).foregroundStyle(r.onSurface.color)
            }
            .tint(r.primary.color).disabled(loaded.saving)
        }
        if let error = loaded.error {
            Text(error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
        }
        if loaded.enabled, let url = loaded.url, let image = QRCode.image(for: url) {
            QRTile(image: image, label: String(localized: "selfcheckin.code"))
            HStack(spacing: 8) {
                if let link = URL(string: url) {
                    ShareLink(item: link) {
                        Text("selfcheckin.share").font(.system(size: 14, weight: .bold)).foregroundStyle(r.onPrimary.color)
                            .frame(maxWidth: .infinity, minHeight: 46).background(r.primary.color, in: Capsule())
                    }
                }
                if canManage {
                    SkPillButton(String(localized: "selfcheckin.new_key"), variant: .tonal, wide: true) { confirming = true }.disabled(loaded.saving)
                }
            }
            PosterButton(url: url, clinicName: clinicName, caption: String(localized: "pqr.poster.checkin"))
        } else if !loaded.enabled {
            Text("selfcheckin.off").font(.footnote).foregroundStyle(r.onSurfaceVariant.color)
        }
    }
}

/// Book appointment: the clinic's public booking page, with the link, Copy and Share.
private struct BookQRTab: View {
    let url: String?
    let clinicName: String
    @Environment(\.skTheme) private var theme
    @State private var copied = false

    var body: some View {
        let r = theme.roles
        VStack(spacing: 14) {
            Text("pqr.book.about").font(.footnote).foregroundStyle(r.onSurfaceVariant.color).frame(maxWidth: .infinity, alignment: .leading)
            if let url, let image = QRCode.image(for: url) {
                QRTile(image: image, label: String(localized: "pqr.book.code"))
                Text(url).font(.system(size: 12, design: .monospaced)).foregroundStyle(r.onSurface.color)
                    .multilineTextAlignment(.center).textSelection(.enabled)
                HStack(spacing: 8) {
                    SkPillButton(String(localized: copied ? "pqr.copied" : "pqr.copy"), variant: .tonal, wide: true) {
                        UIPasteboard.general.string = url
                        copied = true
                    }
                    if let link = URL(string: url) {
                        ShareLink(item: link) {
                            Text("selfcheckin.share").font(.system(size: 14, weight: .bold)).foregroundStyle(r.onPrimary.color)
                                .frame(maxWidth: .infinity, minHeight: 46).background(r.primary.color, in: Capsule())
                        }
                    }
                }
                PosterButton(url: url, clinicName: clinicName, caption: String(localized: "pqr.poster.book"))
            } else {
                Text("pqr.book.unavailable").font(.footnote).foregroundStyle(r.onSurfaceVariant.color)
            }
        }
        .frame(maxWidth: .infinity)
    }
}
