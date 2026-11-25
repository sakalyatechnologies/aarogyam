import AarogyamShared
import SakalyaUI
import SwiftUI

/// The one-step walk-in (Clear Glass): mobile (registered patients show as soon as it is complete),
/// name, age and sex for someone new in one inset-grouped card, allergies and doctor as chips,
/// consent, then "Add to queue" pinned above the home indicator as the glass primary button.
struct WalkInScreen: View {
    let holder: WalkInStateHolder
    let state: WalkInState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                switch onEnum(of: state) {
                case .notAllowed:
                    SkEmptyState(String(localized: "walk_in.not_allowed.title"), message: String(localized: "walk_in.not_allowed.message"))
                case .done(let done):
                    WalkInDoneView(done: done, onAnother: holder.startAnother, onClose: { dismiss() })
                case .editing(let editing):
                    WalkInFormView(holder: holder, form: editing.form)
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if case .editing(let editing) = onEnum(of: state) {
                GlassWideButton(title: String(localized: "walk_in.submit"), systemImage: "checkmark", loading: editing.form.submitting, action: holder.submit)
                    .padding(.horizontal, SkSpacing.l).padding(.top, 8).padding(.bottom, 8)
            }
        }
    }
}

/// The form; every field forwards to the state holder, which owns the values.
private struct WalkInFormView: View {
    let holder: WalkInStateHolder
    let form: WalkInForm
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        GroupedCard {
            WalkInFieldRow(label: String(localized: "walk_in.mobile")) {
                TextField("98xxxxxxxx", text: Binding(get: { form.mobile }, set: { holder.setMobile(typed: $0) }))
                    .keyboardType(.phonePad).textContentType(.telephoneNumber).monospacedDigit()
                    .accessibilityLabel(String(localized: "walk_in.mobile"))
            }
            if form.showNewPatient {
                GroupedDivider(inset: GroupedSizes.rowPaddingH)
                WalkInFieldRow(label: String(localized: "walk_in.name")) {
                    TextField(String(localized: "v7.walk_in.name.prompt"), text: Binding(get: { form.name }, set: { holder.setName(text: $0) }))
                        .textContentType(.name).accessibilityLabel(String(localized: "walk_in.name"))
                }
                GroupedDivider(inset: GroupedSizes.rowPaddingH)
                WalkInFieldRow(label: String(localized: "walk_in.age")) {
                    TextField("", text: Binding(get: { form.age }, set: { holder.setAge(text: $0) })).keyboardType(.numberPad)
                        .accessibilityLabel(String(localized: "walk_in.age"))
                }
                GroupedDivider(inset: GroupedSizes.rowPaddingH)
                WalkInFieldRow(label: String(localized: "walk_in.sex")) {
                    Picker(String(localized: "walk_in.sex"), selection: Binding(get: { form.sex }, set: { if let sex = $0 { holder.setSex(value: sex) } })) {
                        ForEach([Sex.female, Sex.male, Sex.other], id: \.self) { sex in Text(sex.label ?? "").tag(Optional(sex)) }
                    }
                    .pickerStyle(.segmented)
                }
            }
        }
        .padding(.top, SkSpacing.s)
        WalkInMatches(holder: holder, form: form)
        GroupedHeader(String(localized: "v7.walk_in.allergies"))
        V7Flow(spacing: 8) {
            GlassChip(text: String(localized: "walk_in.no_known_allergies"), selected: form.noKnownAllergies, check: true) { holder.toggleNoKnownAllergies() }
            ForEach(form.allergyPicks, id: \.self) { pick in
                GlassChip(text: pick, selected: !form.noKnownAllergies && form.allergies.contains(pick), check: true) { holder.toggleAllergy(label: pick) }
            }
        }
        if !form.doctors.isEmpty {
            GroupedHeader(String(localized: "walk_in.doctor"))
            V7Flow(spacing: 8) {
                GlassChip(text: String(localized: "walk_in.doctor.any"), selected: form.doctorId == nil) { holder.setDoctor(id: nil) }
                ForEach(form.doctors, id: \.id) { doctor in
                    GlassChip(text: doctor.name, selected: form.doctorId == doctor.id) { holder.setDoctor(id: doctor.id) }
                }
            }
        }
        GroupedCard {
            Toggle(isOn: Binding(get: { form.reminders }, set: { holder.setReminders(on: $0) })) {
                Label { Text("v7.walk_in.consent").font(.subheadline).foregroundStyle(r.onSurface.color) } icon: {
                    Image(systemName: "message.fill").foregroundStyle(r.primary.color)
                }
            }
            .tint(r.primary.color)
            .padding(.horizontal, GroupedSizes.rowPaddingH).frame(minHeight: 56)
        }
        .padding(.top, 16)
        if let problem = form.problem?.message ?? form.error?.message {
            Text(problem).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color).padding(.horizontal, 4).padding(.top, 12)
        }
    }
}

/// One labelled row of the walk-in card: a muted label column and the field.
private struct WalkInFieldRow<Field: View>: View {
    let label: String
    @ViewBuilder let field: Field
    @Environment(\.skTheme) private var theme
    @ScaledMetric(relativeTo: .footnote) private var labelWidth: CGFloat = 88

    var body: some View {
        HStack(spacing: 12) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(theme.roles.onSurfaceVariant.color)
                .lineLimit(2).frame(width: min(labelWidth, 140), alignment: .leading)
                .accessibilityHidden(true)
            field.font(.body).foregroundStyle(theme.roles.onSurface.color)
        }
        .padding(.horizontal, GroupedSizes.rowPaddingH).frame(minHeight: 52)
    }
}

/// Registered patients with the typed number, and "Someone new", as rows of one grouped card.
private struct WalkInMatches: View {
    let holder: WalkInStateHolder
    let form: WalkInForm
    @Environment(\.skTheme) private var theme

    var body: some View {
        let muted = theme.roles.onSurfaceVariant.color
        switch onEnum(of: form.lookup) {
        case .idle:
            Text("walk_in.mobile.hint").font(.footnote).foregroundStyle(muted).padding(.horizontal, 4).padding(.top, 8)
        case .looking:
            HStack { ProgressView(); Text("walk_in.looking").font(.footnote) }.foregroundStyle(muted).padding(.horizontal, 4).padding(.top, 10)
        case .failed:
            Text("walk_in.lookup_failed").font(.footnote).foregroundStyle(muted).padding(.horizontal, 4).padding(.top, 8)
        case .matches(let matches):
            Text("walk_in.mobile.hint").font(.footnote).foregroundStyle(muted).padding(.horizontal, 4).padding(.top, 8)
            GroupedCard {
                ForEach(matches.items, id: \.id) { match in
                    matchRow(match.name, line: patientLine(number: match.number, ageYears: match.ageYears?.intValue, sex: match.sex), on: isChosen(match)) {
                        holder.pick(match: match)
                    }
                    GroupedDivider()
                }
                matchRow(String(localized: "walk_in.someone_new"), line: nil, on: isNew, new: true) { holder.someoneNew() }
            }
            .padding(.top, 8)
        }
    }

    private func matchRow(_ title: String, line: String?, on: Bool, new: Bool = false, action: @escaping () -> Void) -> some View {
        PatientChoiceRow(title: title, line: line, on: on, new: new, action: action)
    }

    private func isChosen(_ match: PhoneMatchRow) -> Bool {
        if case .existing(let who) = onEnum(of: form.who) { who.id == match.id } else { false }
    }

    private var isNew: Bool {
        if case .new = onEnum(of: form.who) { true } else { false }
    }
}

/// One registered patient (or "someone new") to pick; shared with the QR arrivals sheet.
struct PatientChoiceRow: View {
    let title: String
    let line: String?
    let on: Bool
    var new = false
    let action: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        Button(action: action) {
            HStack(spacing: 12) {
                if new {
                    Image(systemName: "person.badge.plus").font(.body.weight(.semibold)).foregroundStyle(r.primary.color)
                        .frame(width: 40).accessibilityHidden(true)
                } else {
                    GroupedAvatar(name: title)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.body.weight(.semibold)).foregroundStyle((new ? r.primary : r.onSurface).color)
                    if let line { Text(line).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color) }
                }
                Spacer(minLength: 0)
                if on { Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(r.primary.color).accessibilityHidden(true) }
            }
        }
        .buttonStyle(GroupedRowStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
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
            GlassWideButton(title: String(localized: "walk_in.another"), prominent: false, action: onAnother)
            GlassWideButton(title: String(localized: "v7.done"), action: onClose)
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
