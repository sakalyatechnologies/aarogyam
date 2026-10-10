import AarogyamShared
import SakalyaUI
import SwiftUI

/// The one-step walk-in in the v7 sheet: mobile (registered patients show as soon as it is
/// complete), name and sex for someone new, allergies, consent, doctor, then "Add to queue".
struct WalkInScreen: View {
    let holder: WalkInStateHolder
    let state: WalkInState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch onEnum(of: state) {
                case .notAllowed:
                    SkEmptyState(String(localized: "walk_in.not_allowed.title"), message: String(localized: "walk_in.not_allowed.message"))
                case .done(let done):
                    WalkInDoneView(done: done, onAnother: holder.startAnother, onClose: { dismiss() })
                case .editing(let editing):
                    WalkInFormView(holder: holder, form: editing.form)
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 10)
            .padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
    }
}

/// The form; every field forwards to the state holder, which owns the values.
private struct WalkInFormView: View {
    let holder: WalkInStateHolder
    let form: WalkInForm
    @Environment(\.skTheme) private var theme

    var body: some View {
        SkSheetHeader(String(localized: "walk_in.title"), subtitle: String(localized: "v7.walk_in.message"))
        SkField(
            String(localized: "walk_in.mobile"),
            text: Binding(get: { form.mobile }, set: { holder.setMobile(typed: $0) }),
            placeholder: "98xxxxxxxx", contentType: .telephoneNumber, keyboard: .phonePad
        )
        WalkInMatches(holder: holder, form: form)
        if form.showNewPatient {
            SkField(String(localized: "walk_in.name"), text: Binding(get: { form.name }, set: { holder.setName(text: $0) }),
                    placeholder: String(localized: "v7.walk_in.name.prompt"), contentType: .name)
            HStack(alignment: .bottom, spacing: 8) {
                SkField(String(localized: "walk_in.age"), text: Binding(get: { form.age }, set: { holder.setAge(text: $0) }), keyboard: .numberPad)
                    .frame(maxWidth: 110)
                HStack(spacing: 8) {
                    ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in
                        SkChoiceChip(sex.label ?? "", selected: form.sex == sex) { holder.setSex(value: sex) }
                    }
                }
            }
        }
        V7Label(text: String(localized: "v7.walk_in.allergies"))
        SkChoiceChips(
            [""] + form.allergyPicks,
            selected: Set(form.noKnownAllergies ? [""] : Array(form.allergies)),
            label: { $0.isEmpty ? String(localized: "walk_in.no_known_allergies") : $0 },
            onToggle: { $0.isEmpty ? holder.toggleNoKnownAllergies() : holder.toggleAllergy(label: $0) }
        )
        if !form.doctors.isEmpty {
            V7Label(text: String(localized: "walk_in.doctor"))
            SkChoiceChips(
                [""] + form.doctors.map(\.id),
                selected: [form.doctorId ?? ""],
                label: { id in id.isEmpty ? String(localized: "walk_in.doctor.any") : form.doctors.first { $0.id == id }?.name ?? "" },
                onToggle: { holder.setDoctor(id: $0.isEmpty ? nil : $0) }
            )
        }
        Toggle(isOn: Binding(get: { form.reminders }, set: { holder.setReminders(on: $0) })) {
            Text("v7.walk_in.consent").font(.system(size: 12)).foregroundStyle(theme.roles.onSurfaceVariant.color)
        }
        .tint(theme.roles.primary.color)
        if let problem = form.problem?.message ?? form.error?.message {
            Text(problem).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.roles.error.color)
        }
        SkPillButton(String(localized: "walk_in.submit"), variant: .warm, wide: true, loading: form.submitting, action: holder.submit)
    }
}

/// Registered patients with the typed number, and "Someone new".
private struct WalkInMatches: View {
    let holder: WalkInStateHolder
    let form: WalkInForm
    @Environment(\.skTheme) private var theme

    var body: some View {
        switch onEnum(of: form.lookup) {
        case .idle:
            Text("walk_in.mobile.hint").font(.system(size: 12)).foregroundStyle(theme.roles.onSurfaceVariant.color)
        case .looking:
            HStack { ProgressView(); Text("walk_in.looking").font(.system(size: 12.5)) }
        case .failed:
            Text("walk_in.lookup_failed").font(.system(size: 12.5)).foregroundStyle(theme.roles.onSurfaceVariant.color)
        case .matches(let matches):
            VStack(spacing: 3) {
                ForEach(matches.items, id: \.id) { match in
                    matchRow(match.name, line: patientLine(number: match.number, ageYears: match.ageYears?.intValue, sex: match.sex), on: isChosen(match)) {
                        holder.pick(match: match)
                    }
                }
                matchRow(String(localized: "walk_in.someone_new"), line: nil, on: isNew) { holder.someoneNew() }
            }
        }
    }

    private func matchRow(_ title: String, line: String?, on: Bool, action: @escaping () -> Void) -> some View {
        let r = theme.roles
        return Button(action: action) {
            HStack(spacing: 10) {
                SkAvatar(title, tone: on ? .brand : .neutral, size: 36, shape: .circle)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                    if let line { Text(line).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color) }
                }
                Spacer(minLength: 0)
                if on { V7Icon(name: "check", size: 18, tint: r.primary.color) }
            }
            .padding(.vertical, 9).padding(.horizontal, 11)
            .background((on ? r.primaryContainer : r.card).color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.skPressable)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func isChosen(_ match: PhoneMatchRow) -> Bool {
        if case .existing(let who) = onEnum(of: form.who) { who.id == match.id } else { false }
    }

    private var isNew: Bool {
        if case .new = onEnum(of: form.who) { true } else { false }
    }
}

/// In the queue: the check mark draws on, with the token number.
private struct WalkInDoneView: View {
    let done: WalkInStateDone
    let onAnother: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            SkCheckDraw()
            SkSheetHeader(
                String(format: String(localized: "walk_in.done.title"), Int(done.tokenNumber)),
                subtitle: String(format: String(localized: "walk_in.done.message"), done.name)
            )
            .multilineTextAlignment(.center)
            SkPillButton(String(localized: "walk_in.another"), variant: .tonal, wide: true, action: onAnother)
            SkPillButton(String(localized: "v7.done"), wide: true, action: onClose)
        }
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
