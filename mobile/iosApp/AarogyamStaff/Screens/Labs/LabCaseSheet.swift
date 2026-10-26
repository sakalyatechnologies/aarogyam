import AarogyamShared
import SakalyaUI
import SwiftUI

/// One lab case: its details, Call and WhatsApp (the text carries the case number, never a patient name), a reminder,
/// Mark received and the contact log. Writes need `labs.write`.
struct LabCaseSheet: View {
    let holder: LabsStateHolder
    let caseId: String
    let state: LabsState
    let zone: String
    @State private var logging = false
    @State private var channel = ContactChannel.call
    @State private var outcome: ContactOutcome?
    @State private var promised = Date()
    @State private var note = ""
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    private var item: LabCase? { state.cases.first { $0.id == caseId } }

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let item {
                    SkSheetHeader(item.titleText, subtitle: "\(item.patientName) · \(item.patientNumber)")
                    let pill = item.status.pill(overdue: LabFormat.isOverdue(dueOn: item.dueOn, today: LabFormat.today(zone: zone)))
                    V7Pill(text: pill.text, kind: pill.kind)
                    V7Card {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.detailText).v7Text(13).foregroundStyle(r.onSurface.color)
                            if let contact = item.contactName { V7Muted(contact) }
                            if let last = item.lastContactedAt, let text = ClinicFormat.dateTime(iso8601: last, zone: zone) {
                                V7Muted(pvf("pv.lab.last_contact", text))
                            }
                        }
                    }
                    if let error = state.error { Text(error.message).v7Text(12.5).foregroundStyle(r.error.color) }
                    contactRow(item)
                    if state.canWrite { writeActions(item) }
                    if logging { logForm(item) }
                } else {
                    V7Muted(pv("pv.labs.none"))
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
    }

    private func contactRow(_ item: LabCase) -> some View {
        HStack(spacing: 8) {
            if let url = PatientLinks.tel(item.phone) {
                SkPillButton(pv("pv.action.call"), variant: .tonal, icon: V7Icon.path("phone"), wide: true) { openURL(url) }
            }
            if let url = PatientLinks.whatsApp(item.phone, message: LabFormat.whatsAppText(number: item.number, work: item.work)) {
                SkPillButton(pv("pv.action.whatsapp"), variant: .tonal, icon: V7Icon.path("wa"), wide: true) { openURL(url) }
            }
        }
    }

    @ViewBuilder private func writeActions(_ item: LabCase) -> some View {
        let busy = state.busy == item.id
        HStack(spacing: 8) {
            SkPillButton(pv("pv.lab.log"), variant: .glass, wide: true) { logging.toggle() }
            SkPillButton(pv("pv.lab.remind"), variant: .glass, wide: true, loading: busy) { holder.remind(caseId: item.id) }
        }
        if item.status.open {
            SkPillButton(pv("pv.lab.received"), wide: true, loading: busy) { holder.move(caseId: item.id, to: .received, note: nil) }
        }
    }

    @ViewBuilder private func logForm(_ item: LabCase) -> some View {
        V7Label(text: pv("pv.lab.channel"))
        SkChoiceChips(Array(ContactChannel.allCases), selected: [channel], label: { $0.title }) { channel = $0 }
        V7Label(text: pv("pv.lab.outcome"))
        SkChoiceChips(Array(ContactOutcome.allCases), selected: outcome.map { [$0] } ?? [], label: { $0.title }) { outcome = $0 == outcome ? nil : $0 }
        if outcome == .promisedDate {
            DatePicker(pv("pv.lab.promised"), selection: $promised, in: Date()..., displayedComponents: .date)
                .v7Text(13, .semibold).tint(theme.roles.primary.color)
        }
        SkField(pv("pv.form.note"), text: $note)
        SkPillButton(pv("pv.lab.save_log"), wide: true, loading: state.busy == item.id) {
            holder.logContact(
                caseId: item.id, channel: channel, outcome: outcome, note: note.isEmpty ? nil : note,
                promisedOn: outcome == .promisedDate ? LabFormat.iso(promised, zone: zone) : nil
            )
            logging = false
            note = ""
        }
    }
}
