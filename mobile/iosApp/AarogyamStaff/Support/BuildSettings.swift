import AarogyamShared
import Foundation

/// Reads the build's environment (Info.plist) and Supabase settings (BuildSettings.plist).
enum BuildSettings {
    static func current(bundle: Bundle = .main) -> AppConfig {
        let secrets = bundle.url(forResource: "BuildSettings", withExtension: "plist")
            .flatMap { NSDictionary(contentsOf: $0) as? [String: Any] } ?? [:]
        #if DEBUG
        let debug = true
        #else
        let debug = false
        #endif
        return config(info: bundle.infoDictionary ?? [:], secrets: secrets, debug: debug)
    }

    /// The config from the two dictionaries; an unknown environment falls back to Prod.
    static func config(info: [String: Any], secrets: [String: Any], debug: Bool) -> AppConfig {
        let environment: AppEnvironment =
            switch info["AarogyamEnvironment"] as? String {
            case "Local": .local
            case "Demo": .demo
            default: .prod
            }
        return AppConfig(
            environment: environment,
            version: info["CFBundleShortVersionString"] as? String ?? "0",
            debug: debug,
            supabaseUrl: secrets["SupabaseURL"] as? String ?? "",
            supabaseKey: secrets["SupabaseKey"] as? String ?? "",
            prodAppHost: secrets["ProdAppHost"] as? String ?? ""
        )
    }
}
