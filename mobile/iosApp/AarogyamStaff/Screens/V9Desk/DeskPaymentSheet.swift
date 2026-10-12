import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// Collect payment for a patient: the bill, the amount, how it was paid (UPI, Cash, Card) and an
/// optional proof photo. Online it records at once with an Idempotency-Key; offline it is saved on
/// the phone ("Saved, will send") and goes out when the network is back.
struct DeskPaymentSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let target: DeskPayTarget

    var body: some View {
        ScreenHost(make: { graph.deskPayment(clinic: clinic, patientId: target.patientId, screen: $0) }, state: { $0.state }) { holder, state in
            DeskPaymentScreen(holder: holder, state: state, target: target)
        }
        .presentationDetents([.large])
    }
}

private struct DeskPaymentScreen: View {
    let holder: DeskPaymentStateHolder
    let state: DeskPayState
    let target: DeskPayTarget
    @State private var invoiceId: String?
    @State private var amount = ""
    @State private var amountEdited = false
    @State private var method: PayMethod?
    @State private var showProblems = false
    @State private var proof: Data?
    @State private var camera = false
    @State private var library: PhotosPickerItem?
    @State private var outcome: DeskPayOutcome = DeskPayOutcomeIdle.shared
    @State private var pending = 0
    @State private var net = V9Connectivity()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                switch onEnum(of: outcome) {
                case .recorded(let done): recorded(done)
                case .saved: saved
                case .alreadyPaid: alreadyPaid
                default: form
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
        .task { for await next in holder.outcome { outcome = next } }
        .task { for await next in holder.pending { pending = Int(truncating: next) } }
        .task { await DeskLaunch.attachSampleProof { proof = $0 } }
        .onChange(of: library) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self) { proof = PhotoPrep.jpeg(from: data) }
            }
        }
        .sheet(isPresented: $camera) {
            CameraPicker { data in proof = PhotoPrep.jpeg(from: data) }.ignoresSafeArea()
        }
    }

    @ViewBuilder private var form: some View {
        SkSheetHeader(dv("d9.pay.title"), subtitle: target.name)
        if pending > 0 { savedBadge(dvf("d9.pay.pending", pending)) }
        switch onEnum(of: state) {
        case .loading:
            SkLoadingIndicator(String(localized: "v7.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xl)
        case .notAllowed:
            SkEmptyState(dv("d9.pay.not_allowed.title"), message: dv("d9.pay.not_allowed.message"))
        case .failed(let failed):
            SkEmptyState(dv("d9.pay.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
        case .ready(let ready):
            fields(ready)
        }
    }

    @ViewBuilder private func fields(_ ready: DeskPayStateReady) -> some View {
        let r = theme.roles
        let dues = ready.dues
        if dues.isEmpty {
            SkEmptyState(dv("d9.pay.none.title"), message: dv("d9.pay.none.message"))
        } else {
            let chosen = dues.first { $0.id == invoiceId } ?? dues[0]
            if !net.online {
                Text(dv("d9.pay.offline")).v7Text(12.5, .semibold).foregroundStyle(r.onErrorContainer.color)
                    .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(r.errorContainer.color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            if dues.count > 1 {
                V7Label(text: dv("d9.pay.bill"))
                SkChoiceChips(dues.map(\.id), selected: [chosen.id], label: { id in
                    let due = dues.first { $0.id == id }
                    return [due?.number, due?.draft == true ? dv("d9.pay.draft_tag") : nil, ClinicFormat.rupees(paise: due?.balancePaise ?? 0)].compactMap { $0 }.joined(separator: " · ")
                }) { pick in
                    invoiceId = pick
                    if !amountEdited, let due = dues.first(where: { $0.id == pick }) { amount = DeskPay.rupeesText(paise: due.balancePaise) }
                }
            } else {
                Text(dvf("d9.pay.due", ClinicFormat.rupees(paise: chosen.balancePaise))).v7Text(13, .semibold).foregroundStyle(r.onSurfaceVariant.color)
            }
            if chosen.draft {
                Text(dv("d9.pay.draft_note")).v7Text(12.5, .semibold).foregroundStyle(r.onTertiaryContainer.color)
                    .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            let problems = showProblems ? DeskPay.problems(amountText: amount, method: method) : []
            SkField(dv("d9.pay.amount"), text: Binding(get: { amount }, set: { amount = $0; amountEdited = true; holder.dismissOutcome() }),
                    error: problems.contains(.amount) ? dv("d9.pay.amount.invalid") : nil, keyboard: .decimalPad)
                .onAppear { if amount.isEmpty { amount = DeskPay.rupeesText(paise: chosen.balancePaise) } }
            V7Label(text: dv("d9.pay.method"))
            SkChoiceChips(Array(PayMethod.allCases), selected: method.map { [$0] } ?? [], label: { $0.label }) { method = $0 }
            if problems.contains(.method) {
                Text(dv("d9.pay.method.required")).v7Text(12, .semibold).foregroundStyle(r.error.color)
            }
            proofSection(ready.canAttachProof)
            if case .failed(let failed) = onEnum(of: outcome) {
                Text(failed.error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
            }
            SkPillButton(dv("d9.pay.record"), wide: true, loading: isSending) { record(chosen) }
        }
    }

    private var isSending: Bool { if case .sending = onEnum(of: outcome) { true } else { false } }

    private func record(_ due: DueBill) {
        showProblems = true
        guard DeskPay.problems(amountText: amount, method: method).isEmpty,
              let paise = DeskPay.paise(from: amount), let method else { return }
        holder.record(invoiceId: due.id, amountPaise: paise, method: method, proofJpeg: proof?.kotlinBytes)
    }

    /// "Attach proof": the camera or the photo library; the photo is saved as the payment's proof.
    @ViewBuilder private func proofSection(_ allowed: Bool) -> some View {
        let r = theme.roles
        V7Label(text: dv("d9.pay.proof"))
        if !allowed {
            Text(dv("d9.pay.proof.locked")).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
        } else if let proof, let image = UIImage(data: proof) {
            HStack(alignment: .top, spacing: 12) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityLabel(dv("d9.pay.proof.photo.a11y"))
                VStack(alignment: .leading, spacing: 8) {
                    SkPillButton(dv("d9.pay.proof.remove"), variant: .ghost) { self.proof = nil; library = nil }
                }
            }
        } else {
            FlowLayout(spacing: 8) {
                if CameraPicker.isAvailable {
                    SkPillButton(dv("d9.pay.camera"), variant: .tonal) { camera = true }
                }
                PhotosPicker(selection: $library, matching: .images) {
                    Text(dv("d9.pay.library")).font(.system(size: 14, weight: .bold)).foregroundStyle(r.onPrimaryContainer.color)
                        .padding(.horizontal, 18).frame(minHeight: SkSpacing.minTouchTarget)
                        .background(r.primaryContainer.color, in: Capsule())
                }
            }
        }
    }

    private func recorded(_ done: DeskPayOutcomeRecorded) -> some View {
        VStack(spacing: 12) {
            SkCheckDraw()
            SkSheetHeader(dv("d9.pay.recorded.title"), subtitle: dvf("d9.pay.recorded.message", done.number)).multilineTextAlignment(.center)
            switch done.proof {
            case .sent: Text(dv("d9.pay.proof.sent")).v7Text(12.5).foregroundStyle(theme.roles.onSurfaceVariant.color)
            case .notSent: Text(dv("d9.pay.proof.not_sent")).v7Text(12.5, .semibold).foregroundStyle(theme.roles.error.color)
            default: EmptyView()
            }
            SkPillButton(dv("d9.done"), wide: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }

    private var saved: some View {
        VStack(spacing: 12) {
            savedBadge(dv("d9.pay.saved"))
            Text(dv("d9.pay.saved.message")).v7Text(13).foregroundStyle(theme.roles.onSurfaceVariant.color).multilineTextAlignment(.center)
            SkPillButton(dv("d9.done"), wide: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }

    /// Someone else settled the bill first (the re-check before paying found a zero balance).
    private var alreadyPaid: some View {
        VStack(spacing: 12) {
            savedBadge(dv("d9.pay.already"))
            Text(dv("d9.pay.already.message")).v7Text(13).foregroundStyle(theme.roles.onSurfaceVariant.color).multilineTextAlignment(.center)
            SkPillButton(dv("d9.done"), wide: true) { dismiss() }
        }
        .frame(maxWidth: .infinity)
    }

    /// The "Saved, will send" badge.
    private func savedBadge(_ text: String) -> some View {
        HStack(spacing: 6) {
            V7Icon(name: "clock", size: 16, tint: theme.roles.onTertiaryContainer.color)
            Text(text).v7Text(13, .bold)
        }
        .foregroundStyle(theme.roles.onTertiaryContainer.color)
        .padding(.horizontal, 12).frame(minHeight: 32)
        .background(theme.roles.tertiaryContainer.color, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}
