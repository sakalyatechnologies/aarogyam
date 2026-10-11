import AarogyamShared
import SakalyaUI
import SwiftUI

/// A past visit: summary cells, treatment done, notes by S, O, A and P, the prescription dose grid,
/// X-rays and photos, and the bill with Record payment (the patient's billing holder).
struct V9VisitDetail: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let visitId: String
    let phone: String?
    let billing: BillingStateHolder
    let billingState: BillingState

    var body: some View {
        ScreenHost(make: { graph.visitDetail(clinic: clinic, visitId: visitId, patientId: patientId, screen: $0) }, state: { $0.state }) { holder, state in
            V9VisitDetailBody(
                holder: holder, state: state, graph: graph, clinic: clinic, patientId: patientId, visitId: visitId, phone: phone,
                billing: billing, billingState: billingState
            )
        }
        .navigationTitle(p9("p9.visit.title"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct V9VisitDetailBody: View {
    let holder: VisitDetailStateHolder
    let state: VisitDetailState
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let visitId: String
    let phone: String?
    let billing: BillingStateHolder
    let billingState: BillingState
    @State private var sendRx: VisitRxRef?
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                switch onEnum(of: state) {
                case .loading: V9SectionState(title: p9("p9.visit.title"), kind: .loading)
                case .notAllowed: V9SectionState(title: p9("p9.visit.title"), kind: .notAllowed)
                case .failed(let failed): V9SectionState(title: p9("p9.visit.title"), kind: .failed(failed.error), retry: holder.refresh)
                case .loaded(let loaded):
                    if let error = loaded.error { V9ErrorLine(error: error) }
                    detail(loaded.view)
                }
            }
            .padding(.horizontal, SkSpacing.l).padding(.bottom, SkSpacing.xxl)
        }
        .background(theme.roles.background.color)
        .refreshable { holder.refresh() }
        .sheet(isPresented: Binding(get: { billLoaded?.form != nil }, set: { if !$0 { billing.cancelPayment() } })) {
            if let form = billLoaded?.form { PaymentSheet(holder: billing, form: form) }
        }
        .onChange(of: receipt) { _, new in if new != nil { holder.refresh() } }
        .sheet(item: $sendRx) { ref in
            V9SendRxSheet(graph: graph, clinic: clinic, patientId: patientId, visitId: visitId, rx: ref, phone: phone) { sendRx = nil }
        }
    }

    private var billLoaded: BillingStateLoaded? {
        if case .loaded(let value) = onEnum(of: billingState) { value } else { nil }
    }

    private var receipt: String? { billLoaded?.receipt }

    @ViewBuilder private func detail(_ view: VisitDetailView) -> some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 2) {
            Text(HistoryRowFormat.title(complaint: view.title, procedure: view.procedures.first?.name, kind: nil)).v7Text(22, .heavy).foregroundStyle(r.onSurface.color)
            Text(subtitle(view)).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        summary(view)
        treatmentCard(view)
        notesCard(view)
        rxCard(view)
        filesCard(view)
        billCard(view)
    }

    private func subtitle(_ view: VisitDetailView) -> String {
        let when = view.at.map { ClinicFormat.date(iso: $0.date.isoText) + " · " + ClinicFormat.time(minuteOfDay: $0.time.minuteOfDay) }
        return [when, view.clinician].compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: Summary

    private func summary(_ view: VisitDetailView) -> some View {
        let teeth = Array(Set(view.procedures.compactMap { $0.tooth?.intValue })).sorted()
        return V7Flow(spacing: 8) {
            summaryCell(p9("p9.visit.treatments"), String(view.procedures.count))
            summaryCell(p9("p9.visit.teeth"), teeth.isEmpty ? "–" : teeth.map(String.init).joined(separator: ", "))
            summaryCell(p9("p9.visit.medicines"), String(view.rx?.items.count ?? 0))
        }
    }

    private func summaryCell(_ label: String, _ value: String) -> some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 1) {
            Text(label).v7Text(11, .bold).foregroundStyle(r.onSurfaceVariant.color)
            Text(value).v7Text(16, .heavy).foregroundStyle(r.onSurface.color)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // MARK: Treatment

    private func treatmentCard(_ view: VisitDetailView) -> some View {
        let r = theme.roles
        return V7Card {
            VStack(alignment: .leading, spacing: 8) {
                V9SectionHead(title: p9("p9.visit.done"))
                if view.procedures.isEmpty {
                    V7Muted(p9("p9.visit.done.none"))
                } else {
                    ForEach(view.procedures, id: \.id) { proc in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(proc.name).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                                Text(proc.tooth.map { p9f("p9.tooth_n", $0.intValue) } ?? p9("p9.whole_mouth"))
                                    .v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                            }
                            Spacer(minLength: 4)
                            if let fee = proc.feePaise { Text(ClinicFormat.rupees(paise: fee.int64Value)).v7Text(14, .bold).foregroundStyle(r.onSurface.color) }
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    // MARK: Notes

    @ViewBuilder private func notesCard(_ view: VisitDetailView) -> some View {
        let notes = view.notes
        let groups: [(String, String, [String])] = [
            ("S", p9("p9.note.s"), notes.subjective), ("O", p9("p9.note.o"), notes.objective),
            ("A", p9("p9.note.a"), notes.assessment), ("P", p9("p9.note.p"), notes.plan),
        ].filter { !$0.2.isEmpty }
        V7Card {
            VStack(alignment: .leading, spacing: 8) {
                V9SectionHead(title: p9("p9.visit.notes"), note: notes.signedBy.map { p9f("p9.visit.signed_by", $0) })
                if groups.isEmpty {
                    V7Muted(p9("p9.visit.notes.none"))
                } else {
                    ForEach(groups, id: \.0) { letter, name, lines in
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                noteTag(letter, name)
                                Text(line).v7Text(14).foregroundStyle(theme.roles.onSurface.color)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(name + ": " + line)
                        }
                    }
                }
            }
        }
    }

    private func noteTag(_ letter: String, _ name: String) -> some View {
        let r = theme.roles
        return Text(name).v7Text(10.5, .heavy).foregroundStyle(r.onPrimaryContainer.color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(r.primaryContainer.color, in: Capsule())
            .fixedSize()
    }

    // MARK: Prescription

    @ViewBuilder private func rxCard(_ view: VisitDetailView) -> some View {
        if let rx = view.rx {
            V7Card {
                VStack(alignment: .leading, spacing: 10) {
                    V9SectionHead(title: p9("p9.visit.rx"), note: [rx.number, rx.issued ? p9("p9.visit.rx.signed") : p9("p9.visit.rx.draft")].compactMap { $0 }.joined(separator: " · "))
                    ForEach(Array(rx.items.enumerated()), id: \.offset) { _, item in
                        MedicineCard(
                            name: [item.name, item.strength].compactMap { $0 }.joined(separator: " "),
                            form: item.form,
                            display: DoseDisplay.make(
                                frequency: item.frequency, timing: item.timing, days: item.durationDays?.intValue, form: item.form
                            )
                        )
                    }
                    if rx.issued, clinic.permissions.contains("prescriptions.issue") {
                        SkPillButton(p9("p9.visit.rx.send"), variant: .tonal, icon: V7Icon.path("wa"), wide: true) {
                            sendRx = VisitRxRef(id: rx.id, number: rx.number)
                        }
                    }
                }
            }
        } else {
            V7Card { V7Muted(p9("p9.visit.rx.none")) }
        }
    }

    // MARK: Files

    @ViewBuilder private func filesCard(_ view: VisitDetailView) -> some View {
        if !view.files.isEmpty {
            let r = theme.roles
            V7Card {
                VStack(alignment: .leading, spacing: 8) {
                    V9SectionHead(title: p9("p9.media"), note: String(view.files.count))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 8)], spacing: 8) {
                        ForEach(view.files, id: \.id) { file in
                            let xray = file.kind == "xray"
                            let title = file.label ?? (xray ? p9("p9.media.xray") : p9("p9.media.photo"))
                            VStack(spacing: 4) {
                                V7Icon(name: xray ? "tooth" : "cam", size: 22, tint: r.primary.color)
                                Text(title).v7Text(12, .bold).foregroundStyle(r.onSurface.color).multilineTextAlignment(.center)
                            }
                            .padding(8).frame(maxWidth: .infinity, minHeight: 76)
                            .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel(title)
                        }
                    }
                }
            }
        }
    }

    // MARK: Bill

    @ViewBuilder private func billCard(_ view: VisitDetailView) -> some View {
        if view.moneyVisible {
            let r = theme.roles
            if let bill = view.bill {
                V7Card {
                    VStack(alignment: .leading, spacing: 8) {
                        V9SectionHead(title: p9("p9.visit.bill"), note: bill.number)
                        billLine(p9("p9.bill.total"), bill.totalPaise, tone: nil)
                        billLine(p9("p9.bill.paid"), bill.paidPaise, tone: nil)
                        if bill.balancePaise > 0 { billLine(p9("p9.bill.due"), bill.balancePaise, tone: r.error.color) }
                        if let receipt { V7Pill(text: pvf("pv.bills.recorded", receipt), kind: .done) }
                        if let error = billLoaded?.error { Text(error.message).v7Text(12.5).foregroundStyle(r.error.color) }
                        if bill.balancePaise > 0 {
                            if billLoaded?.canRecord == true {
                                SkPillButton(p9("p9.bill.record"), variant: .warm, wide: true) { billing.startPayment(billId: bill.id) }
                            }
                        } else {
                            V7Pill(text: p9("p9.bill.paid_full"), kind: .done)
                        }
                    }
                }
            } else {
                V7Card { V7Muted(p9("p9.visit.bill.none")) }
            }
        }
    }

    private func billLine(_ label: String, _ paise: Int64, tone: Color?) -> some View {
        HStack {
            Text(label).v7Text(14)
            Spacer(minLength: 4)
            Text(ClinicFormat.rupees(paise: paise)).v7Text(14, .bold)
        }
        .foregroundStyle(tone ?? theme.roles.onSurface.color)
        .accessibilityElement(children: .combine)
    }
}

/// One medicine: name, kind and timing, the morning, afternoon and night cells, then the days and the total.
struct MedicineCard: View {
    let name: String
    let form: String?
    let display: DoseDisplay
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                    Text([form?.capitalized, display.timing].compactMap { $0 }.joined(separator: " · "))
                        .v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                }
                Spacer(minLength: 4)
                if !display.frequency.isEmpty { V7Pill(text: display.frequency, kind: .neutral) }
            }
            HStack(spacing: 6) {
                ForEach(display.cells, id: \.label) { cell in
                    VStack(spacing: 1) {
                        Text(cell.label).v7Text(10.5, .bold).lineLimit(1).minimumScaleFactor(0.7)
                        Text(cell.value).v7Text(17, .heavy)
                    }
                    .foregroundStyle((cell.on ? r.onPrimaryContainer : r.onSurfaceVariant).color)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background((cell.on ? r.primaryContainer : r.surface3).color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(cell.label + ": " + cell.value)
                }
            }
            HStack {
                if let days = display.days { Text(days).v7Text(12.5) }
                Spacer(minLength: 4)
                if let total = display.total { Text(total).v7Text(12.5, .bold) }
            }
            .foregroundStyle(r.onSurfaceVariant.color)
        }
        .padding(12)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// The signed prescription of a visit, to send again.
struct VisitRxRef: Identifiable { let id: String; let number: String? }

/// "Send prescription": a fresh link and PIN for the visit's signed Rx, then WhatsApp, SMS or Print.
struct V9SendRxSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let visitId: String
    let rx: VisitRxRef
    let phone: String?
    let onDone: () -> Void

    var body: some View {
        ScreenHost(
            make: { graph.rxSheetInVisit(clinic: clinic, patientId: patientId, allergies: [], visitId: visitId, screen: $0) },
            state: { $0.state }
        ) { holder, state in
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    SkSheetHeader(p9("p9.visit.rx.send"), subtitle: rx.number)
                    RxDelivery(holder: holder, state: state, phone: phone, onDone: onDone)
                }
                .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
            }
            .skSheet()
            .onAppear { holder.shareIssued(id: rx.id, number: rx.number) }
        }
    }
}
