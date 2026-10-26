import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Add treatment form: treatment chips, surfaces, a material dropdown (with "Add new"), the
/// Completed, Planned or Watch status, a note and Save. Why Save cannot be pressed shows beside it.
struct AddTreatmentForm: View {
    let holder: ChartStateHolder
    let chart: ChartStateLoaded
    let sheet: ToothSheetStateHolder
    let form: TreatmentFormState
    let tooth: ToothView
    let group: [Int32]
    let onBack: () -> Void
    @State private var newMaterial = ""
    @State private var addingMaterial = false
    @Environment(\.skTheme) private var theme

    private var procedures: [TermView] { ChartModelKt.matchTerms(terms: chart.terms, kind: .procedure, text: "") }
    private var materials: [TermView] { ChartModelKt.matchTerms(terms: chart.terms, kind: .material, text: "") }
    private var wholeTooth: Bool { form.treatment.flatMap { ProcedureFindings.shared.of(term: $0) }?.wholeTooth ?? false }

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 12) {
            Button(action: onBack) {
                HStack(spacing: 4) {
                    V7Icon(name: "back", size: 16, tint: r.primary.color)
                    Text(form.editing == nil ? pv("pv.form.title") : pv("pv.form.edit")).v7Text(14, .heavy).foregroundStyle(r.onSurface.color)
                }
                .frame(minHeight: 44)
            }
            .accessibilityLabel(pv("pv.form.back"))
            V7Label(text: pv("pv.form.treatment"))
            SkChoiceChips(procedures, selected: Set(form.treatment.map { [$0] } ?? []), label: { $0.own ? pvf("pv.form.own", $0.label) : $0.label }) {
                sheet.chooseTreatment(term: $0 == form.treatment ? nil : $0)
            }
            V7Label(text: pv("pv.form.surfaces"))
            HStack(spacing: 8) {
                ForEach(Surface.allCases, id: \.self) { surface in
                    SkChoiceChip(Self.letter(surface), selected: form.surfaces.contains(surface)) { sheet.toggleSurface(surface: surface) }
                        .accessibilityLabel(tooth.surfaceText(surface))
                }
            }
            .disabled(wholeTooth)
            .opacity(wholeTooth ? 0.4 : 1)
            if wholeTooth { V7Muted(pv("pv.form.whole")) }
            V7Label(text: pv("pv.form.material"))
            materialMenu
            if addingMaterial { addMaterial }
            V7Label(text: pv("pv.form.status"))
            SkSegmented(TreatmentStatus.allCases.map(\.title), selectedIndex: TreatmentStatus.allCases.firstIndex(of: form.status) ?? 0) {
                sheet.setStatus(status: TreatmentStatus.allCases[$0])
            }
            SkField(pv("pv.form.note"), text: Binding(get: { form.note }, set: { sheet.setNote(text: $0) }))
            footer
        }
        .onChange(of: chart.addedTerm?.id) { _, id in
            guard id != nil, let term = chart.addedTerm else { return }
            if term.kind == .material { sheet.chooseMaterial(term: term) } else { sheet.chooseTreatment(term: term) }
            holder.consumeAddedTerm()
            addingMaterial = false
            newMaterial = ""
        }
    }

    /// A field-shaped menu: the chosen material, "None", the clinic's list, and "Add new".
    private var materialMenu: some View {
        let r = theme.roles
        return Menu {
            Button(pv("pv.form.none")) { sheet.chooseMaterial(term: nil) }
            ForEach(materials, id: \.id) { term in Button(term.own ? pvf("pv.form.own", term.label) : term.label) { sheet.chooseMaterial(term: term) } }
            Divider()
            Button(pv("pv.form.add_new")) { addingMaterial = true }
        } label: {
            HStack {
                Text(form.material?.label ?? pv("pv.form.choose")).v7Text(15)
                    .foregroundStyle((form.material == nil ? r.onSurfaceVariant : r.onSurface).color)
                Spacer()
                V7Icon(name: "chev", size: 16, tint: r.onSurfaceVariant.color).rotationEffect(.degrees(90))
            }
            .padding(.horizontal, 14).frame(minHeight: 46)
            .background(r.surface3.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .accessibilityLabel(pv("pv.form.material"))
    }

    private var addMaterial: some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 8) {
            SkField(pv("pv.form.new_material"), text: $newMaterial)
            if let error = chart.termError { Text(pvf("pv.form.term_failed", error.message)).v7Text(12.5).foregroundStyle(r.error.color) }
            HStack(spacing: 8) {
                SkPillButton(pv("pv.form.add"), variant: .tonal, loading: chart.addingTerm) { holder.addTerm(kind: .material, label: newMaterial) }
                    .disabled(newMaterial.trimmingCharacters(in: .whitespaces).isEmpty)
                SkPillButton(chartText("chart.cancel"), variant: .ghost) { addingMaterial = false; newMaterial = ""; holder.consumeAddedTerm() }
            }
        }
    }

    @ViewBuilder private var footer: some View {
        let r = theme.roles
        if case .blocked(let blocked) = onEnum(of: form.check) {
            HStack(alignment: .top, spacing: 8) {
                V7Icon(name: "spark", size: 16, tint: r.onTertiaryContainer.color)
                Text(blocked.reason.message).v7Text(12.5, .semibold).foregroundStyle(r.onTertiaryContainer.color)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityElement(children: .combine)
        }
        if let error = form.error { Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
        let ok: Bool = if case .ok = onEnum(of: form.check) { true } else { false }
        SkPillButton(pv("pv.form.save"), wide: true, loading: form.saving) { sheet.save(tooth: Int32(tooth.number)) }
            .disabled(!ok || chart.saving)
    }

    /// The mockup's one-letter surface chips.
    static func letter(_ surface: Surface) -> String {
        switch surface {
        case .m: "M"
        case .o: "O"
        case .d: "D"
        case .b: "B"
        case .l: "L"
        }
    }
}
