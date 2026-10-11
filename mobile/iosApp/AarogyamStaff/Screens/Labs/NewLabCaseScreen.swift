import AarogyamShared
import SakalyaUI
import SwiftUI

/// "New lab case": choose the patient, then the lab, the work, a due date and instructions.
struct NewLabCaseFlow: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let labs: [LabRow]
    let onCreated: () -> Void
    @State private var patient: PatientRow?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        if let patient {
            ScreenHost(make: { graph.doNewLabCase(clinic: clinic, patientId: patient.id, visitId: nil, screen: $0) }, state: { $0.state }) { holder, state in
                NewLabCaseForm(holder: holder, state: state, labs: labs, patientName: patient.name, onDone: { onCreated(); dismiss() })
            }
        } else {
            ScreenHost(make: { graph.patients(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                LabPatientPicker(holder: holder, state: state) { patient = $0 }
            }
        }
    }
}

private struct LabPatientPicker: View {
    let holder: PatientsStateHolder
    let state: PatientsState
    let onPick: (PatientRow) -> Void
    @State private var text = ""
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(pv("pv.newlab.title"), subtitle: pv("pv.newlab.pick"))
                SkSearchField(text: $text, prompt: pv("pv.patients.search")).onChange(of: text) { _, new in holder.search(text: new) }
                if case .loaded(let loaded) = onEnum(of: state) {
                    VStack(spacing: 3) {
                        ForEach(Array(loaded.items.enumerated()), id: \.element.id) { index, row in
                            Button { onPick(row) } label: { V7ListSurface(index: index, count: loaded.items.count) { PatientListRow(row: row, alternate: index % 2 == 1) } }
                                .buttonStyle(.skPressable)
                        }
                    }
                } else {
                    SkLoadingIndicator(pv("pv.loading")).frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
    }
}

private struct NewLabCaseForm: View {
    let holder: NewLabCaseStateHolder
    let state: NewLabCaseState
    let labs: [LabRow]
    let patientName: String
    let onDone: () -> Void
    @State private var workType = ""
    @State private var teeth = ""
    @State private var shade = ""
    @State private var material = ""
    @State private var qty = 1
    @State private var hasDue = false
    @State private var due = Date()
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let number = state.created {
                    VStack(spacing: 12) {
                        SkCheckDraw().frame(width: 72, height: 72)
                        Text(pvf("pv.newlab.created", number)).v7Text(18, .heavy).foregroundStyle(r.onSurface.color)
                        SkPillButton(String(localized: "done"), wide: true, action: onDone)
                    }.frame(maxWidth: .infinity)
                } else {
                    SkSheetHeader(pv("pv.newlab.title"), subtitle: patientName)
                    V7Label(text: pv("pv.newlab.lab"))
                    SkChoiceChips(labs, selected: Set(labs.filter { $0.id == state.labId }), label: { $0.name }) { holder.chooseLab(labId: $0.id, contactId: nil) }
                    if let lab = labs.first(where: { $0.id == state.labId }), !lab.contacts.isEmpty {
                        SkChoiceChips(lab.contacts, selected: Set(lab.contacts.filter { $0.id == state.contactId }), label: { $0.name }) {
                            holder.chooseLab(labId: lab.id, contactId: $0.id)
                        }
                    }
                    V7Label(text: pv("pv.newlab.work"))
                    ForEach(Array(state.work.enumerated()), id: \.offset) { index, item in workRow(index, item) }
                    workEditor
                    Toggle(pv("pv.newlab.due"), isOn: $hasDue).v7Text(13, .semibold).tint(r.primary.color)
                        .onChange(of: hasDue) { _, on in holder.setDue(day: on ? LabFormat.iso(due, zone: TimeZone.current.identifier) : nil) }
                    if hasDue {
                        DatePicker(pv("pv.newlab.due"), selection: $due, in: Date()..., displayedComponents: .date).labelsHidden()
                            .onChange(of: due) { _, new in holder.setDue(day: LabFormat.iso(new, zone: TimeZone.current.identifier)) }
                    }
                    SkField(pv("pv.newlab.instructions"), text: Binding(get: { state.instructions }, set: { holder.setInstructions(text: $0) }))
                    if let error = state.error { Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
                    HStack(spacing: 8) {
                        SkPillButton(pv("pv.newlab.draft"), variant: .tonal, wide: true) { holder.save(send: false) }
                        SkPillButton(pv("pv.newlab.send"), wide: true, loading: state.saving) { holder.save(send: true) }
                    }
                    .disabled(!state.canSave)
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
    }

    private func workRow(_ index: Int, _ item: LabWork) -> some View {
        let r = theme.roles
        return HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(item.workType) × \(item.qty)").v7Text(13, .bold).foregroundStyle(r.onSurface.color)
                let detail = ([item.teeth.isEmpty ? nil : pvf("pv.lab.teeth", item.teeth.map { String($0.intValue) }.joined(separator: ", ")), item.shade, item.material]
                    .compactMap { $0 }.filter { !$0.isEmpty }).joined(separator: " · ")
                if !detail.isEmpty { V7Muted(detail) }
            }
            Spacer()
            Button { holder.removeWork(index: Int32(index)) } label: { V7Icon(name: "plus", size: 18, tint: r.error.color).rotationEffect(.degrees(45)).frame(width: 44, height: 44) }
                .accessibilityLabel(pv("pv.newlab.remove"))
        }
        .padding(.horizontal, 12)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var workEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            SkField(pv("pv.newlab.work_type"), text: $workType)
            HStack(spacing: 8) {
                SkField(pv("pv.newlab.teeth"), text: $teeth, keyboard: .numbersAndPunctuation)
                SkField(pv("pv.newlab.shade"), text: $shade)
            }
            SkField(pv("pv.form.material"), text: $material)
            Stepper(pvf("pv.newlab.qty", qty), value: $qty, in: 1...20).v7Text(13, .semibold)
            SkPillButton(pv("pv.newlab.add_work"), variant: .tonal) {
                holder.addWork(work: LabWork(workType: workType, teeth: LabFormat.parseTeeth(teeth).map { KotlinInt(int: Int32($0)) }, shade: shade, material: material, qty: Int32(qty)))
                workType = ""; teeth = ""; shade = ""; material = ""; qty = 1
            }
            .disabled(workType.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
}
