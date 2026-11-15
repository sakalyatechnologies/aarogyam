import Foundation

func c11(_ key: String.LocalizationValue) -> String { String(localized: key, table: "ChatV11") }

/// Small rules for chat files, kept apart from the views so they can be tested.
enum ChatFile {
    /// The link as a URL, only when it is plain web (http or https) with a host; anything else is not opened.
    static func openable(_ link: String) -> URL? {
        guard let url = URL(string: link), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http", url.host?.isEmpty == false else { return nil }
        return url
    }

    /// "340 KB", "1.2 MB".
    static func sizeLabel(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
