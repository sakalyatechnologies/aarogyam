// Development sign-in: compiled only into debug builds of the Local environment, where the API
// is the developer's own machine. Demo and Prod builds contain none of this (see ios-check.sh).
#if DEBUG && AARO_ENV_Local
import AarogyamShared
import Foundation
import Security
import SakalyaUI
import SwiftUI

/// One button per seeded person (`db/seed/local.sql`). It asks the local API for a development
/// token, saves it as the session in the Keychain, as the shared auth code does, and has the
/// graph restore it.
struct DevSignInPanel: View {
    let graph: AppGraph
    @Environment(\.skTheme) private var theme
    @State private var failed = false

    private static let people: [(name: String, authUid: String)] = [
        ("Asha Kulkarni (owner, Sunrise)", "a1a1a1a1-0000-4000-8000-000000000001"),
        ("Dr Dev Rao (doctor, Sunrise and Lotus)", "a1a1a1a1-0000-4000-8000-000000000002"),
        ("Farah Shaikh (front desk, Sunrise)", "a1a1a1a1-0000-4000-8000-000000000003"),
        ("Bina Joshi (owner, Lotus)", "b1b1b1b1-0000-4000-8000-000000000001"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            Text("Development sign-in (local debug build)")
                .skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
            if failed {
                Text("The local API did not answer.")
                    .skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
            }
            ForEach(Self.people, id: \.authUid) { person in
                SkButton(person.name, variant: .secondary) {
                    Task {
                        failed = !(await signIn(as: person.authUid))
                    }
                }
            }
        }
        .padding(SkSpacing.xl)
        .background(theme.palette.background.color)
    }

    private func signIn(as authUid: String) async -> Bool {
        guard let url = URL(string: "http://app.localtest.me:5173/api/v1/dev/token") else { return false }
        var request = URLRequest(url: url, timeoutInterval: 5)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(#"{"auth_uid":"\#(authUid)"}"#.utf8)
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = body["access_token"] as? String,
              let lifetime = body["expires_in"] as? Double
        else { return false }
        let session: [String: Any] = [
            "access_token": token,
            "refresh_token": "dev-token-has-no-refresh",
            "expires_at": Int(Date().timeIntervalSince1970 + lifetime),
            "user_id": authUid,
            "version": 1,
        ]
        guard let json = try? JSONSerialization.data(withJSONObject: session), save(json) else { return false }
        graph.restore()
        return true
    }

    /// Writes the session where `SecureSessionStore` reads it: the app's Keychain service, the
    /// store's default key.
    private func save(_ data: Data) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.aarogyam.staff",
            kSecAttrAccount as String: "sakalya.auth.session",
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }
}
#endif
