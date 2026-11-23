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
    /// Below the screen languages, the language this person dictates voice notes in (kept on this phone).
    var graph: AppGraph?
    @State private var voice: DictationLanguage?
    @Environment(\.openURL) private var openURL
    @Environment(\.skTheme) private var theme

    private static let languages: [(code: String, name: String)] = [("en", "English"), ("hi", "हिन्दी"), ("mr", "मराठी")]

    /// The language picked here; iOS applies an app's language when the app next starts.
    @State private var picked: String?

    private func choose(_ code: String) {
        picked = code
        UserDefaults.standard.set([code], forKey: "AppleLanguages")
    }

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
                        .contentShape(Rectangle())
                        .onTapGesture { choose(language.code) }
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(language.code == current ? [.isSelected, .isButton] : .isButton)
                    }
                }
                if let picked, picked != current {
                    Text(CL("c.language.restart")).font(.footnote.weight(.semibold)).foregroundStyle(r.primary.color)
                }
                SkPillButton(CL("c.language.open"), wide: true) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                if let graph, let chosen = voice {
                    Text("voice.language").font(.system(size: 15, weight: .bold)).foregroundStyle(r.onSurface.color).padding(.top, 8)
                    SkChoiceChips(Array(DictationLanguage.allCases), selected: [chosen], label: { $0.chipLabel }) {
                        voice = $0
                        graph.setVoiceLanguage(language: $0)
                    }
                }
            }
            .padding(.horizontal, SkSheetSizes.paddingH)
            .padding(.top, SkSheetSizes.paddingTop + SkSheetSizes.grabGap)
            .padding(.bottom, SkSheetSizes.paddingBottom)
        }
        .skSheet()
        .onAppear { voice = graph?.voiceLanguage() }
    }
}

/// Light, dark or the phone's look, kept on this phone; the whole app switches at once.
struct AppearanceSheet: View {
    let preference: AppearancePreference
    @State private var current: Appearance = .system
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let all = Array(Appearance.allCases)
        VStack(alignment: .leading, spacing: SkSheetSizes.gap) {
            SkSheetHeader(String(localized: "v7.tile.appearance"))
            VStack(spacing: 3) {
                ForEach(Array(all.enumerated()), id: \.element) { index, option in
                    Button {
                        preference.set(appearance: option)
                        current = option
                        dismiss()
                    } label: {
                        HStack {
                            Text(option.title).font(.system(size: 15, weight: .bold)).foregroundStyle(r.onSurface.color)
                            Spacer(minLength: 0)
                            if option == current { V7Icon(name: "check", size: 20, tint: r.primary.color) }
                        }
                        .padding(.vertical, 13).padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .background(r.card.color, in: UnevenRoundedRectangle(cornerRadii: MoreSizes.listRadii(index, of: all.count), style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(option == current ? .isSelected : [])
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, SkSheetSizes.paddingH)
        .padding(.top, SkSheetSizes.paddingTop + SkSheetSizes.grabGap)
        .task { current = preference.state.value }
    }
}

extension Appearance {
    var title: String {
        switch self {
        case .system: String(localized: "appearance.system")
        case .light: String(localized: "appearance.light")
        case .dark: String(localized: "appearance.dark")
        }
    }

    /// What SwiftUI's `preferredColorScheme` takes: nil follows the phone.
    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}
