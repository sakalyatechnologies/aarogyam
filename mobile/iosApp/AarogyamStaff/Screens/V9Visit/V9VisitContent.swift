import AarogyamShared
import SakalyaUI
import SwiftUI

/// The open visit's scroll: header, notes, prescription, procedures and close, with the state
/// the close needs (what is staged, whether the prescription card is open, the follow-up).
struct V9VisitContent: View {
    let graph: AppGraph
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
    #if DEBUG && AARO_ENV_Local
    @State private var devAction: String?
    #endif
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollViewReader { scroller in
            ScrollView {
                VStack(spacing: SkSpacing.ml) {
                    V9Header(graph: graph, view: view, patient: patient, chair: route.chair, closed: view.closed)
                    VStack(spacing: SkSpacing.ml) {
                        if view.closed {
                            V9Summary(graph: graph, clinic: clinic, visitId: view.visitId, phone: person?.phone, firstName: firstName, patientNumber: view.number, snapshot: snapshot, minutes: minutes) { dismiss() }
                        } else {
                            if !connectivity.online { V9OfflineBanner() }
                            DoctorV10VisitEntry(graph: graph, clinic: clinic, patientId: route.patientId, patientName: person?.name ?? "", holder: holder, view: view, rx: rx)
                            V9Notes(holder: holder, view: view).id("notes")
                            V9RxCard(
                                rx: rx, state: rxState, phone: person?.phone, canIssue: clinic.permissions.contains("prescriptions.issue"),
                                open: $rxOpen, draftKept: $rxDraftKept
                            )
                            .id("rx")
                            V9Procedures(chart: chart, state: chartState, staged: $staged, locked: closing || view.closing).id("procs")
                            V9CloseArea(
                                confirm: $confirmClose, followUpOn: $followUpOn, followUpDate: $followUpDate, feeText: $feeText,
                                canBill: clinic.permissions.contains("billing.write"), canFollowUp: clinic.permissions.contains("patients.write"),
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
            #if DEBUG && AARO_ENV_Local
            .task { await devSteps(scroller) }
            .onChange(of: devAction) { _, action in
                // Read here, where the view's values are current, not in the long-running task.
                switch action {
                case "confirm": requestClose()
                case "close": performClose()
                case "sign": rx.issue()
                default: break
                }
                devAction = nil
            }
            #endif
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

    /// `YYYY-MM-DD` in the device calendar, the day the recall falls due.
    private static func isoDay(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
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
            followUp: followUpOn && clinic.permissions.contains("patients.write") ? followUpDate : nil,
            feePaise: clinic.permissions.contains("billing.write") ? V9Close.paise(fromRupees: feeText) : nil
        )
        Task {
            if !(await commitProcedures()) { closing = false; return closeError = V9("v9v.close.procedures_failed") }
            if !view.bullets.isEmpty, view.save != .signed {
                holder.sign()
                if !(await waitSigned()) { closing = false; return closeError = V9("v9v.close.sign_failed") }
            }
            holder.closeWith(
                followUpOn: followUpOn && clinic.permissions.contains("patients.write") ? Self.isoDay(followUpDate) : nil, reason: nil,
                feePaise: clinic.permissions.contains("billing.write") ? V9Close.paise(fromRupees: feeText).map { KotlinLong(value: $0) } : nil
            )
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

#if DEBUG && AARO_ENV_Local
extension V9VisitContent {
    /// Local debug builds only, for screenshot runs: `SIMCTL_CHILD_AAROGYAM_DEV_VISIT_STEPS` is a
    /// `;`-separated list of `notes`, `rx`, `add:<drug search>`, `proc`, `sign`, `confirm`, `close`,
    /// `scroll:<id>` and `wait:<seconds>`, run in order once the visit is open.
    func devSteps(_ scroller: ScrollViewProxy) async {
        guard let steps = ProcessInfo.processInfo.environment["AAROGYAM_DEV_VISIT_STEPS"] else { return }
        for step in steps.split(separator: ";").map(String.init) {
            try? await Task.sleep(for: .seconds(1.2))
            let parts = step.split(separator: ":", maxSplits: 1).map(String.init)
            switch parts[0] {
            case "notes":
                holder.addBullet(kind: .complaint, text: "Pain in the lower right molar for two days, worse with cold")
                holder.addBullet(kind: .finding, text: "Deep caries on 46, tender to percussion")
                holder.addBullet(kind: .advice, text: "Root canal treatment advised; avoid hot food today")
            case "rx": withAnimation { rxOpen = true }
            case "add":
                rx.search(query: parts.count > 1 ? parts[1] : "a")
                for _ in 0..<12 {
                    try? await Task.sleep(for: .milliseconds(400))
                    if let drug = rx.state.value.results.first { rx.add(drug: drug); break }
                }
            case "proc":
                if case .loaded(let loaded) = onEnum(of: chart.state.value) {
                    let terms = ChartModelKt.matchTerms(terms: loaded.terms, kind: .procedure, text: "")
                    let tooth = (loaded.upper + loaded.lower).first { !$0.findings.isEmpty }.map { Int($0.number) } ?? 46
                    for term in terms.prefix(2) { staged.append(StagedProcedure(tooth: tooth, term: term)) }
                }
            case "sign", "confirm", "close": devAction = parts[0]
            case "fee": feeText = "1500"; followUpOn = true
            case "scroll": withAnimation { scroller.scrollTo(parts.count > 1 ? parts[1] : "close", anchor: .center) }
            case "wait": try? await Task.sleep(for: .seconds(Double(parts.count > 1 ? parts[1] : "1") ?? 1))
            default: break
            }
        }
    }
}
#endif
