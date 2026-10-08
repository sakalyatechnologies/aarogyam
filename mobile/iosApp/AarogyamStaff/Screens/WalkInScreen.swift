import AarogyamShared
import SakalyaUI
import SwiftUI

/// The one-step walk-in, as a sheet: mobile, who, intake, doctor, then "Add to queue".
struct WalkInScreen: View {
    let holder: WalkInStateHolder
    let state: WalkInState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(String(localized: "walk_in.title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(String(localized: "walk_in.close")) { dismiss() }
                    }
                }
        }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .notAllowed:
            SkEmptyState(String(localized: "walk_in.not_allowed.title"), message: String(localized: "walk_in.not_allowed.message"))
        case .done(let done):
            SkEmptyState(
                String(format: String(localized: "walk_in.done.title"), Int(done.tokenNumber)),
                message: String(format: String(localized: "walk_in.done.message"), done.name),
                actionTitle: String(localized: "walk_in.another"),
                action: holder.startAnother
            )
        case .editing(let editing):
            WalkInFormView(holder: holder, form: editing.form)
        }
    }
}

/// The form itself; every field forwards to the state holder, which owns the values.
private struct WalkInFormView: View {
    let holder: WalkInStateHolder
    let form: WalkInForm
    @Environment(\.skTheme) private var theme

    var body: some View {
        Form {
            WalkInMobileSection(holder: holder, form: form)
            if form.showNewPatient { WalkInNewPatientSection(holder: holder, form: form) }
            WalkInIntakeSections(holder: holder, form: form)
            if let problem = form.problem?.message ?? form.error?.message {
                Text(problem).foregroundStyle(theme.palette.dangerText.color)
            }
            Section {
                Button(action: holder.submit) {
                    Text(form.submitting ? String(localized: "walk_in.submitting") : String(localized: "walk_in.submit"))
                        .frame(maxWidth: .infinity)
                        .bold()
                }
                .disabled(form.submitting)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

extension WalkInProblem {
    var message: String {
        switch self {
        case .pickPatient: String(localized: "walk_in.problem.pick")
        case .nameRequired: String(localized: "walk_in.problem.name")
        case .ageInvalid: String(localized: "walk_in.problem.age")
        }
    }
}

/// A row that toggles; shows a checkmark when on.
struct CheckRow: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).foregroundStyle(.primary)
                Spacer()
                if isOn { Image(systemName: "checkmark").foregroundStyle(.tint) }
            }
        }
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
