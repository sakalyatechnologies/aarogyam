import AarogyamShared
import SakalyaUI
import SwiftUI

/// The search found nobody: the full patient fields at once (name from the search), and one
/// Register and book. Once the patient is made, `onRegistered` goes on to the booking sheet for them.
struct RegisterAndBook: View {
    let holder: QuickRegisterStateHolder
    let state: QuickRegisterState
    let searched: String
    let onRegistered: (String) -> Void
    /// The button's words: Register and book, or Add patient when no booking follows.
    var submit: String = RegisterAndBook.t("t7.newpt.submit")
    @State private var tried = false
    @Environment(\.skTheme) private var theme

    private static func t(_ key: String.LocalizationValue) -> String { String(localized: key, table: "TodayV7") }

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 10) {
            V7Label(text: Self.t("t7.newpt.title"))
            SkField(Self.t("t7.newpt.name"), text: Binding(get: { state.name }, set: { holder.setName(text: $0) }))
            V7Label(text: Self.t("t7.newpt.sex"))
            SkChoiceChips([Sex.female, .male, .other], selected: Set(state.sex.map { [$0] } ?? []), label: { $0.label ?? "" }) {
                holder.setSex(sex: $0 == state.sex ? nil : $0)
            }
            SkField(Self.t("t7.newpt.age"), text: Binding(get: { state.age }, set: { holder.setAge(text: $0) })).keyboardType(.numberPad)
            SkField(Self.t("t7.newpt.mobile"), text: Binding(get: { state.mobile }, set: { holder.setMobile(text: $0) })).keyboardType(.phonePad)
            SkField(Self.t("t7.newpt.email"), text: Binding(get: { state.email }, set: { holder.setEmail(text: $0) }))
                .keyboardType(.emailAddress).textInputAutocapitalization(.never)
            V7Label(text: Self.t("t7.newpt.language"))
            SkChoiceChips(Array(PatientLanguage.allCases), selected: [state.language], label: { $0.ownName }) { holder.setLanguage(language: $0) }
            V7Label(text: String(localized: "address.title"))
            AddressFields(address: state.address) { holder.setAddress(field: $0, text: $1) }
            if let text = problemText {
                Text(text).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.error.color)
            }
            SkPillButton(submit, wide: true, loading: state.saving) {
                tried = true
                holder.register()
            }
        }
        .onAppear { holder.start(searched: searched) }
        .onChange(of: state.createdId) { _, id in if let id { onRegistered(id) } }
    }

    private var problemText: String? {
        if tried, let problem = holder.problem(s: state) {
            switch problem {
            case .nameRequired: return Self.t("t7.newpt.name_required")
            case .ageInvalid: return Self.t("t7.newpt.age_invalid")
            case .mobileInvalid: return Self.t("t7.newpt.mobile_invalid")
            case .emailInvalid: return Self.t("t7.newpt.email_invalid")
            }
        }
        return state.error?.message
    }
}

extension PatientLanguage {
    /// Each language in its own script.
    var ownName: String {
        switch self {
        case .english: "English"
        case .hindi: "हिन्दी"
        case .marathi: "मराठी"
        case .gujarati: "ગુજરાતી"
        }
    }
}
