import AarogyamShared
import SakalyaUI
import SwiftUI

/// The open visit's scroll: header, notes, prescription, procedures and close, with the state
/// the close needs (what is staged, whether the prescription card is open, the follow-up).
struct V9VisitContent: View {
    let clinic: ClinicContext
    let route: VisitRoute
    let holder: VisitStateHolder
    let view: VisitView_
    let patient: Patient360State
    let rx: RxSheetStateHolder
    let rxState: RxSheetState
    let chart: ChartStateHolder
    let chartState: ChartState
    let sheet: ToothSheetStateHolder
    let form: TreatmentFormState

    @State private var rxOpen = false
    @State private var rxDraftKept = false
    @State private var staged: [StagedProcedure] = []
    @State private var confirmClose = false
    @State private var closing = false
    @State private var closeError: String?
    @State private var followUpOn = false
    @State private var followUpDate = Calendar.current.date(byAdding: .day, value: 7, to: .now) ?? .now
    @State private var feeText = ""
    @State private var snapshot = V9Snapshot()
    @State private var connectivity = V9Connectivity()
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                VStack(spacing: SkSpacing.ml) {
                    V9Header(view: view, patient: patient, chair: route.chair, closed: view.closed)
                    VStack(spacing: SkSpacing.ml) {
                        if view.closed {
                            V9Summary(firstName: firstName, patientNumber: view.number, snapshot: snapshot, minutes: minutes) { dismiss() }
                        } else {
                            if !connectivity.online { V9OfflineBanner() }
                            V9Notes(holder: holder, view: view)
                            V9RxCard(
                                rx: rx, state: rxState, phone: person?.phone, canIssue: clinic.permissions.contains("prescriptions.issue"),
                                open: $rxOpen, draftKept: $rxDraftKept
                            )
                            .id("rx")
                            V9Procedures(chart: chart, state: chartState, staged: $staged, locked: closing || view.closing)
                            V9CloseArea(
                                confirm: $confirmClose, followUpOn: $followUpOn, followUpDate: $followUpDate, feeText: $feeText,
                                closing: closing || view.closing, error: closeError ?? view.error?.message,
                                onClose: requestClose, onCloseAnyway: performClose, onSignNow: signNow
                            )
                            .id("close")
                        }
                    }
                    .padding(.horizontal, SkSpacing.l)
                }
                .padding(.bottom, SkSpacing.xxl)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: confirmClose) { _, on in
                if on { withAnimation { scroller.scrollTo("close", anchor: .center) } }
            }
        }
    }

    private var person: PatientView? {
        if case .loaded(let loaded) = onEnum(of: patient) { loaded.view } else { nil }
    }

    private var firstName: String {
        person?.name.split(separator: " ").first.map(String.init) ?? V9("v9v.patient")
    }

    private var minutes: Int {
        guard let start = view.startedAt else { return 1 }
        return max(1, (Int(Date.now.timeIntervalSince1970) - Int(start.epochSeconds)) / 60)
    }

    private func requestClose() {
        switch CloseGuard.decide(medicines: rxState.lines.count, signed: rxState.phase == .issued) {
        case .close: performClose()
        case .confirmUnsigned: withAnimation { confirmClose = true }
        }
    }

    /// Sign now: issue the prescription from here, or open it when something stops that.
    private func signNow() {
        confirmClose = false
        rxOpen = true
        if rxState.canIssue { rx.issue() }
    }

    /// Saves what is staged, signs the note, then closes the visit; any step that fails stops here.
    private func performClose() {
        guard !closing else { return }
        confirmClose = false
        closeError = nil
        closing = true
        snapshot = V9Snapshot(
            procedures: staged.map { "\($0.term.label) · \($0.tooth)" },
            notes: view.bullets.count,
            rxNumber: rxState.issued?.number,
            medicines: rxState.phase == .issued ? rxState.lines.count : 0,
            followUp: followUpOn ? followUpDate : nil,
            feePaise: V9Close.paise(fromRupees: feeText)
        )
        Task {
            if !(await commitProcedures()) { closing = false; return closeError = V9("v9v.close.procedures_failed") }
            if !view.bullets.isEmpty, view.save != .signed {
                holder.sign()
                if !(await waitSigned()) { closing = false; return closeError = V9("v9v.close.sign_failed") }
            }
            holder.close()
            closing = false
        }
    }

    /// Logs each staged procedure through the tooth sheet's existing visit call, one at a time.
    private func commitProcedures() async -> Bool {
        for item in staged {
            sheet.setStatus(status: .completed)
            sheet.chooseTreatment(term: item.term)
            sheet.save(tooth: Int32(item.tooth))
            var done = false
            for await next in sheet.form {
                if next.error != nil { return false }
                if next.saved { done = true; break }
            }
            if !done { return false }
        }
        staged = []
        return true
    }

    /// Waits for the note to be signed; false when signing fails.
    private func waitSigned() async -> Bool {
        var sawSaving = false
        for await next in holder.state {
            guard case .open(let open) = onEnum(of: next) else { return false }
            switch open.view.save {
            case .saving: sawSaving = true
            case .signed: return true
            case .failed: if sawSaving { return false }
            default: break
            }
        }
        return false
    }
}
