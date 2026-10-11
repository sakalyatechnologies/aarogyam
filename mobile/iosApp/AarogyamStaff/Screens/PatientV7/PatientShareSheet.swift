import AarogyamShared
import SakalyaUI
import SwiftUI

/// The record kinds the share sheet offers; only the prescription has a link on the server yet.
enum ShareKind: CaseIterable, Hashable {
    case chart, rx, xrays, bills

    var real: Bool { self == .rx }

    var title: String {
        switch self {
        case .chart: pv("pv.share.chart")
        case .rx: pv("pv.share.rx")
        case .xrays: pv("pv.share.xrays")
        case .bills: pv("pv.share.bills")
        }
    }
}

/// The expiry chips; the server's link lasts seven days whatever is chosen (a choice of expiry is BK-22).
enum ShareExpiry: CaseIterable {
    case hour, day, week

    var real: Bool { self == .week }

    var title: String {
        switch self {
        case .hour: pv("pv.share.hour")
        case .day: pv("pv.share.day")
        case .week: pv("pv.share.week")
        }
    }
}

/// "Share record": an expiring link with a PIN. The prescription link is real; chart, X-rays and bills are Preview.
struct PatientShareSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let preselected: String?

    var body: some View {
        ScreenHost(make: { graph.rxList(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { _, state in
            ShareBody(clinic: clinic, state: state, preselected: preselected)
        }
    }
}

private struct ShareBody: View {
    let clinic: ClinicContext
    let state: RxListState
    let preselected: String?
    @State private var kinds: Set<ShareKind> = [.chart, .rx]
    @State private var expiry = ShareExpiry.week
    @State private var model: RxShareModel
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    init(clinic: ClinicContext, state: RxListState, preselected: String?) {
        self.clinic = clinic
        self.state = state
        self.preselected = preselected
        _model = State(initialValue: RxShareModel(clinic: clinic))
    }

    private var issued: [RxSummary] {
        if case .loaded(let loaded) = onEnum(of: state) { loaded.items.filter { $0.status == .issued } } else { [] }
    }

    /// The prescription to share: the one chosen on its card, else the newest issued.
    private var target: RxSummary? { issued.first { $0.id == preselected } ?? issued.first }

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(pv("pv.share.title"), subtitle: pv("pv.share.message"))
                if case .ready(let url, let pin, let expires) = model.phase {
                    ready(url: url, pin: pin, expires: expires)
                } else {
                    V7Label(text: pv("pv.share.expires"))
                    SkChoiceChips(ShareExpiry.allCases, selected: [expiry], label: { $0.title }) { expiry = $0 }
                    SkChoiceChips(ShareKind.allCases, selected: kinds, label: { $0.title }) { kind in
                        if kinds.contains(kind) { kinds.remove(kind) } else { kinds.insert(kind) }
                    }
                    if !expiry.real || kinds.contains(where: { !$0.real }) { PreviewNotice(text: pv("pv.share.preview")) }
                    if target == nil, case .loaded = onEnum(of: state) { V7Muted(pv("pv.share.no_rx")) }
                    if model.phase == .failed { Text(pv("pv.share.failed")).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
                    SkPillButton(pv("pv.share.create"), wide: true, loading: model.phase == .creating) {
                        if let target { Task { await model.create(prescription: target.id) } }
                    }
                    .disabled(target == nil || !kinds.contains(.rx))
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .skSheet()
    }

    @ViewBuilder private func ready(url: URL, pin: String, expires: String?) -> some View {
        let r = theme.roles
        V7Label(text: pv("pv.share.pin"))
        Text(pin).font(.system(size: 34, weight: .heavy, design: .monospaced)).foregroundStyle(r.onSurface.color).kerning(4)
        V7Muted(pv("pv.share.pin_note"))
        if let expires { V7Muted(pvf("pv.share.expires_on", expires)) }
        ShareLink(item: url, subject: Text(pv("pv.share.title")), message: Text(pvf("pv.share.text", clinic.session.clinic.name))) {
            Text(pv("pv.share.send")).v7Text(14, .bold).foregroundStyle(r.onPrimary.color)
                .frame(maxWidth: .infinity, minHeight: 44).background(r.primary.color, in: Capsule())
        }
        SkPillButton(String(localized: "done"), variant: .ghost, wide: true) { dismiss() }
    }
}
