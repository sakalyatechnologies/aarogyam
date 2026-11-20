import AarogyamShared
import SakalyaUI
import SwiftUI
import UIKit

/// The two doctor entry points on the open visit: Chair mode (full screen) and Wrap up (sheet).
struct DoctorV10VisitEntry: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let patientName: String
    let holder: VisitStateHolder
    let view: VisitView_
    let rx: RxSheetStateHolder
    /// Saves the treatments staged on the visit screen; false when one failed. Runs before Finish.
    let saveStaged: () async -> Bool
    @State private var chair = false
    @State private var wrap = false
    @State private var image = false

    var body: some View {
        VStack(spacing: SkSpacing.sm) {
            entries
            // Right after Start visit the first picture is usually the OPG: the camera, labelled so.
            if clinic.permissions.contains("patients.write") || clinic.permissions.contains("clinical.write") {
                SkPillButton(dv10("dv10.add_image"), variant: .tonal, icon: V7Icon.path("cam"), wide: true) { image = true }
            }
        }
        .sheet(isPresented: $image) {
            V9PhotoSheet(graph: graph, clinic: clinic, patientId: patientId, onDone: { image = false }, label: .opg)
        }
    }

    private var entries: some View {
        HStack(spacing: SkSpacing.sm) {
            SkPillButton(dv10("dv10.chair.open"), variant: .tonal, wide: true) { chair = true }
                .accessibilityLabel(dv10("dv10.chair.open.a11y"))
            if clinic.permissions.contains("clinical.write") {
                SkPillButton(dv10("dv10.wrap.open"), variant: .fill, wide: true) { wrap = true }
                    .accessibilityLabel(dv10("dv10.wrap.open.a11y"))
            }
        }
        .fullScreenCover(isPresented: $chair) {
            ChairModeView(graph: graph, clinic: clinic, patientId: patientId, holder: holder, view: view) { chair = false }
        }
        .sheet(isPresented: $wrap) {
            DoctorWrapUpSheet(graph: graph, clinic: clinic, patientId: patientId, patientName: patientName, visitId: view.visitId, holder: holder, rx: rx,
                              saveStaged: saveStaged) { wrap = false }
        }
    }
}

struct DoctorWrapUpSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let patientName: String
    let visitId: String
    let holder: VisitStateHolder
    let rx: RxSheetStateHolder
    let saveStaged: () async -> Bool
    let onClose: () -> Void

    var body: some View {
        ScreenHost(make: { graph.finishVisit(clinic: clinic, visitId: visitId, screen: $0) }, state: { $0.state }) { finish, state in
            WrapUpBody(
                graph: graph, clinic: clinic, patientId: patientId, patientName: patientName, visitId: visitId,
                visit: holder, rx: rx, finish: finish, state: state, saveStaged: saveStaged, onClose: onClose
            )
        }
        .presentationDetents([.large])
    }
}

private struct WrapUpBody: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let patientName: String
    let visitId: String
    let visit: VisitStateHolder
    let rx: RxSheetStateHolder
    let finish: FinishVisitHolder
    let state: FinishState
    let saveStaged: () async -> Bool
    let onClose: () -> Void

    @State private var screen = ScreenScope()
    @State private var savingStaged = false
    @State private var stagedFailed = false
    @State private var box: DoctorFinishSources?
    @State private var feeText = ""
    @State private var feeTouched = false
    @State private var reason = ""
    @State private var pay: DeskPayTarget?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                Text(dv10("dv10.wrap.title")).v7Text(22, .heavy).foregroundStyle(r.onSurface.color).accessibilityAddTraits(.isHeader)
                switch onEnum(of: state.phase) {
                case .done(let done): celebration(done.summary)
                case .finishing: Text(dv10("dv10.wrap.finishing")).v7Text(15, .semibold).foregroundStyle(r.onSurfaceVariant.color)
                case .queued:
                    banner(dv10("dv10.wrap.queued"), error: false)
                    SkPillButton(dv10("dv10.done.button"), variant: .fill, wide: true, action: onClose)
                default: editor
                }
            }
            .padding(SkSpacing.l)
        }
        .background(r.background.color)
        .sheet(item: $pay) { target in DeskPaymentSheet(graph: graph, clinic: clinic, target: target) }
        .onAppear {
            let made = graph.finishSources(clinic: clinic, visit: visit, rx: rx, patientId: patientId, visitId: visitId, screen: screen)
            box = made
            finish.attach(sources: made.sources)
            made.prepare { finish.attach(sources: made.sources) }
        }
        .onDisappear { screen.close() }
        .onChange(of: state.feePaise) { _, paise in
            if !feeTouched { feeText = DoctorV10Format.feeText(paise: paise?.int64Value) }
        }
        .onChange(of: isDone) { _, done in
            guard done, let summary = doneSummary else { return }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            if summary.outcome == .collected, summary.invoiceId != nil { pay = DeskPayTarget(patientId: patientId, name: patientName, invoiceId: summary.invoiceId) }
        }
    }

    private var isDone: Bool { doneSummary != nil }

    private var doneSummary: FinishedSummary? {
        if case .done(let done) = onEnum(of: state.phase) { done.summary } else { nil }
    }

    @ViewBuilder private var editor: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.m) {
            Text(dv10("dv10.wrap.followup")).v7Text(14, .heavy).foregroundStyle(r.onSurfaceVariant.color)
            FlowLayout(spacing: 8) {
                ForEach([FollowUpChoice.oneWeek, .twoWeeks, .oneMonth, .sixMonths, .notNeeded], id: \.self) { choice in
                    SkChoiceChip(DoctorV10Format.followUpLabel(choice), selected: state.followUp == choice) { finish.pickFollowUp(choice: choice) }
                        .frame(minHeight: SkSpacing.minTouchTarget)
                }
            }
            Text(dv10("dv10.wrap.fee")).v7Text(14, .heavy).foregroundStyle(r.onSurfaceVariant.color)
            TextField(dv10("dv10.wrap.fee.hint"), text: $feeText)
                .keyboardType(.numberPad).v7Text(20, .bold).padding(SkSpacing.m).frame(minHeight: 52)
                .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14))
                .accessibilityLabel(dv10("dv10.wrap.fee"))
                .onChange(of: feeText) { _, text in
                    feeTouched = true
                    finish.setFee(paise: DoctorV10Format.feePaise(text: text).map { KotlinLong(value: $0) })
                }
            Toggle(isOn: Binding(get: { state.issueRx }, set: { finish.setIssueRx(on: $0) })) {
                Text(state.hasRxDraft ? dv10("dv10.wrap.rx") : dv10("dv10.wrap.rx.none")).v7Text(16, .bold)
            }
            .disabled(!state.hasRxDraft).frame(minHeight: SkSpacing.minTouchTarget)
            phaseNotes
            SkPillButton(dv10("dv10.wrap.collect"), variant: .fill, wide: true) { go(collect: true) }.disabled(!canFinish || savingStaged)
            // Nobody else collects: the second way is "Bill later" (the same finish), not the desk.
            SkPillButton(dv10(clinic.billsLater ? "dv10.wrap.bill_later" : "dv10.wrap.desk"), variant: .tonal, wide: true) { go(collect: false) }.disabled(!canFinish || savingStaged)
        }
    }

    @ViewBuilder private var phaseNotes: some View {
        let r = theme.roles
        switch onEnum(of: state.phase) {
        case .needsOverride(let override):
            VStack(alignment: .leading, spacing: 8) {
                Text(dv10("dv10.wrap.override.title")).v7Text(15, .heavy).foregroundStyle(r.error.color)
                ForEach(Array(override.alerts.enumerated()), id: \.offset) { _, alert in
                    Text(alert.message).v7Text(13.5, .semibold).foregroundStyle(r.onSurface.color)
                }
                TextField(dv10("dv10.wrap.override.reason"), text: $reason, axis: .vertical)
                    .padding(SkSpacing.m).background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14))
                    .onChange(of: reason) { _, text in finish.setOverrideReason(text: text) }
                    .accessibilityLabel(dv10("dv10.wrap.override.reason"))
            }
        case .needsConnection: banner(dv10("dv10.wrap.offline"), error: true)
        case .failed(let failed): banner(failed.message, error: true)
        default: if stagedFailed { banner(V9("v9v.close.procedures_failed"), error: true) }
        }
    }

    private var canFinish: Bool {
        if case .needsOverride = onEnum(of: state.phase) { return !reason.trimmingCharacters(in: .whitespaces).isEmpty }
        return true
    }

    /// Saves the staged treatments first (they are only on the phone until then), then finishes.
    private func go(collect: Bool) {
        guard !savingStaged else { return }
        savingStaged = true
        stagedFailed = false
        Task {
            let saved = await saveStaged()
            savingStaged = false
            guard saved else { stagedFailed = true; return }
            switch onEnum(of: state.phase) {
            case .needsConnection, .failed: finish.backToEditing()
            default: break
            }
            finish.finish(collectNow: collect)
        }
    }

    private func banner(_ text: String, error: Bool) -> some View {
        let r = theme.roles
        return Text(text).v7Text(14, .bold).foregroundStyle(error ? r.error.color : r.onPrimaryContainer.color)
            .padding(SkSpacing.m).frame(maxWidth: .infinity, alignment: .leading)
            .background(error ? r.surface2.color : r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityAddTraits(.updatesFrequently)
    }

    private func celebration(_ summary: FinishedSummary) -> some View {
        let r = theme.roles
        let text = DoctorV10Format.celebration(
            rxIssued: summary.rxIssued, followUpOn: summary.followUpOn, collected: summary.outcome == .collected,
            totalPaise: summary.invoiceTotalPaise?.int64Value, billsLater: clinic.billsLater
        )
        return VStack(spacing: SkSpacing.l) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 64)).foregroundStyle(r.primary.color).accessibilityHidden(true)
            Text(text).v7Text(18, .heavy).foregroundStyle(r.onSurface.color).multilineTextAlignment(.center)
                .accessibilityAddTraits(.isStaticText)
            if summary.outcome == .collected, summary.invoiceId != nil {
                SkPillButton(dv10("dv10.done.pay"), variant: .tonal, wide: true) { pay = DeskPayTarget(patientId: patientId, name: patientName) }
            }
            DoctorWhatsAppSummary(graph: graph, clinic: clinic, visitId: visitId)
            SkPillButton(dv10("dv10.done.button"), variant: .fill, wide: true, action: onClose)
        }
        .frame(maxWidth: .infinity)
    }
}
