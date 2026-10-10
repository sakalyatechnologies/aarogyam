import AarogyamShared
import SakalyaUI
import SwiftUI

/// Where Help sends people: the support email and WhatsApp number come from Info.plist
/// (`AarogyamSupportEmail`, `AarogyamSupportWhatsApp`), set per build until the domain is chosen.
enum SupportContact {
    static var email: String { plist("AarogyamSupportEmail") }
    static var whatsApp: String { plist("AarogyamSupportWhatsApp") }

    private static func plist(_ key: String) -> String {
        (Bundle.main.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
    }

    static func emailURL(subject: String) -> URL? {
        guard !email.isEmpty else { return nil }
        return URL(string: "mailto:\(email)?subject=\(subject.addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? "")")
    }

    static func whatsAppURL(text: String) -> URL? { ClinicalFormat.whatsAppURL(phone: whatsApp.isEmpty ? nil : whatsApp, text: text) }
}

/// Help and feedback: email and WhatsApp support are real links; chatting inside the app waits
/// for server support.
struct HelpPage: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.l) {
                Text("c.help.message", tableName: "ClinicalV7").font(.system(size: 13.5)).foregroundStyle(r.onSurfaceVariant.color)
                VStack(spacing: 3) {
                    helpRow(icon: "msg", title: CL("c.help.email"), sub: SupportContact.email, first: true, last: false) {
                        if let url = SupportContact.emailURL(subject: CL("c.help.email.subject")) { openURL(url) }
                    }
                    helpRow(icon: "wa", title: CL("c.help.whatsapp"), sub: CL("c.help.whatsapp.sub"), first: false, last: false) {
                        if let url = SupportContact.whatsAppURL(text: CL("c.help.whatsapp.text")) { openURL(url) }
                    }
                    helpRow(icon: "help", title: CL("c.help.chat"), sub: CL("c.help.chat.sub"), first: false, last: true, preview: true) {}
                }
                PreviewNotice(text: CL("c.help.chat.preview"))
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(r.background.color)
        .navigationTitle(CL("c.help.title"))
    }

    private func helpRow(icon: String, title: String, sub: String, first: Bool, last: Bool, preview: Bool = false, action: @escaping () -> Void) -> some View {
        let r = theme.roles
        let corners = RectangleCornerRadii(topLeading: first ? 22 : 8, bottomLeading: last ? 22 : 8, bottomTrailing: last ? 22 : 8, topTrailing: first ? 22 : 8)
        return Button(action: action) {
            HStack(spacing: 10) {
                V7Icon(name: icon, size: 19, tint: r.onSurfaceVariant.color)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                    if !sub.isEmpty { Text(sub).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color) }
                }
                Spacer(minLength: 0)
                if preview { SkChip(CL("c.preview.chip"), tone: .warning) } else { V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color) }
            }
            .padding(.vertical, 9).padding(.horizontal, 11)
            .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: corners, style: .continuous))
        }
        .buttonStyle(.skPressable)
        .disabled(preview)
    }
}

/// The Language sheet: iOS keeps each app's language in Settings, so this shows the languages
/// the app speaks, marks the one in use and opens Settings to change it.
struct LanguageSheet: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    private static let languages: [(code: String, name: String)] = [("en", "English"), ("hi", "हिन्दी"), ("mr", "मराठी")]

    var body: some View {
        let r = theme.roles
        let current = Bundle.main.preferredLocalizations.first?.prefix(2).description ?? "en"
        ScrollView {
            VStack(alignment: .leading, spacing: SkSheetSizes.gap) {
                SkSheetHeader(CL("c.language.title"), subtitle: CL("c.language.message"))
                VStack(spacing: 3) {
                    ForEach(Array(Self.languages.enumerated()), id: \.element.code) { index, language in
                        HStack {
                            Text(language.name).font(.system(size: 15, weight: .bold)).foregroundStyle(r.onSurface.color)
                            Spacer(minLength: 0)
                            if language.code == current { V7Icon(name: "check", size: 20, tint: r.primary.color) }
                        }
                        .padding(.vertical, 13).padding(.horizontal, 14)
                        .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: 3), style: .continuous))
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(language.code == current ? .isSelected : [])
                    }
                }
                SkPillButton(CL("c.language.open"), wide: true) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
            }
            .padding(.horizontal, SkSheetSizes.paddingH)
            .padding(.top, SkSheetSizes.paddingTop + SkSheetSizes.grabGap)
            .padding(.bottom, SkSheetSizes.paddingBottom)
        }
        .skSheet()
    }
}
