import AarogyamShared
import SakalyaUI
import SwiftUI

extension ConsentPurpose {
    var title: String {
        switch self {
        case .care: p9("p9.consent.purpose.care")
        case .reminders: p9("p9.consent.purpose.reminders")
        case .promotional: p9("p9.consent.purpose.promotional")
        case .sharing: p9("p9.consent.purpose.sharing")
        case .research: p9("p9.consent.purpose.research")
        }
    }
}

extension ConsentMethod {
    var title: String {
        switch self {
        case .paper: p9("p9.consent.method.paper")
        case .verbal: p9("p9.consent.method.verbal")
        case .app: p9("p9.consent.method.app")
        }
    }
}

extension ConsentView {
    var purposeTitle: String { purpose?.title ?? purposeKey.capitalized }

    /// `Given 5 Oct 2026, signed on paper · notice v2`, or the withdrawn form.
    var detailLine: String {
        let notice = p9f("p9.consent.notice", noticeVersion)
        if let off = withdrawnAt {
            return [p9f("p9.consent.withdrawn_on", ClinicFormat.date(iso: off.date.isoText)), notice].joined(separator: " · ")
        }
        let given = givenAt.map { ClinicFormat.date(iso: $0.date.isoText) } ?? ""
        let how = method.map { ", " + $0.title.lowercased() } ?? ""
        return [p9f("p9.consent.given_on", given) + how, notice].joined(separator: " · ")
    }
}

/// The Consent tab: given consents with Withdraw, withdrawn ones, and Record a consent.
struct V9ConsentTab: View {
    let holder: ConsentsStateHolder
    let state: ConsentsState
    @State private var recording = false
    @State private var withdrawing: ConsentView?
    @Environment(\.skTheme) private var theme

    var body: some View {
        switch onEnum(of: state) {
        case .loading: V9SectionState(title: p9("p9.tab.consent"), kind: .loading)
        case .notAllowed: V9SectionState(title: p9("p9.tab.consent"), kind: .notAllowed)
        case .failed(let failed): V9SectionState(title: p9("p9.tab.consent"), kind: .failed(failed.error), retry: holder.refresh)
        case .loaded(let loaded): content(loaded)
        }
    }

    @ViewBuilder private func content(_ loaded: ConsentsStateLoaded) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let error = loaded.error, !recording { V9ErrorLine(error: error) }
            V7Card {
                VStack(alignment: .leading, spacing: 4) {
                    V9SectionHead(title: p9("p9.consent.title"), note: p9f("p9.consent.given_count", loaded.active.count))
                    if loaded.active.isEmpty { V7Muted(p9("p9.consent.none")).padding(.vertical, 6) }
                    ForEach(loaded.active, id: \.id) { consent in
                        row(consent, active: true, canWithdraw: loaded.canWithdraw)
                    }
                }
            }
            if !loaded.withdrawn.isEmpty {
                V7Card {
                    VStack(alignment: .leading, spacing: 4) {
                        V9SectionHead(title: p9("p9.consent.withdrawn"), note: String(loaded.withdrawn.count))
                        ForEach(loaded.withdrawn, id: \.id) { consent in row(consent, active: false, canWithdraw: false) }
                    }
                }
            }
            if loaded.canRecord {
                SkPillButton(p9("p9.consent.record"), variant: .tonal, icon: V7Icon.path("plus"), wide: true) { holder.clearError(); recording = true }
            }
        }
        .sheet(isPresented: $recording) { RecordConsentSheet(holder: holder, loaded: loaded, onDone: { recording = false }) }
        .confirmationDialog(
            withdrawing.map { p9f("p9.consent.withdraw_q", $0.purposeTitle) } ?? "",
            isPresented: Binding(get: { withdrawing != nil }, set: { if !$0 { withdrawing = nil } }),
            titleVisibility: .visible, presenting: withdrawing
        ) { consent in
            Button(p9("p9.consent.withdraw_verbal"), role: .destructive) { holder.withdraw(consentId: consent.id, method: .verbal, note: nil) }
            Button(p9("p9.consent.withdraw_paper"), role: .destructive) { holder.withdraw(consentId: consent.id, method: .paper, note: nil) }
            Button(p9("p9.cancel"), role: .cancel) {}
        } message: { consent in
            Text(p9f("p9.consent.withdraw_msg", consent.noticeVersion))
        }
        #if DEBUG && AARO_ENV_Local
        .onAppear { if DevLaunch.consentSheet { recording = true } }
        #endif
    }

    private func row(_ consent: ConsentView, active: Bool, canWithdraw: Bool) -> some View {
        let r = theme.roles
        return HStack(spacing: 12) {
            Image(systemName: active ? "checkmark" : "lock.fill").font(.system(size: 15, weight: .bold))
                .foregroundStyle((active ? r.onPrimaryContainer : r.onSurfaceVariant).color)
                .frame(width: 38, height: 38)
                .background((active ? r.primaryContainer : r.surface3).color, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(consent.purposeTitle).v7Text(14, .bold).foregroundStyle(r.onSurface.color)
                Text(consent.detailLine).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
            if active {
                if canWithdraw {
                    Button { withdrawing = consent } label: {
                        Text(p9("p9.consent.withdraw")).v7Text(12, .bold).foregroundStyle(r.primary.color)
                            .padding(.horizontal, 12).frame(minHeight: 44)
                            .background(r.surface2.color, in: Capsule())
                    }
                    .buttonStyle(.skPressable)
                    .accessibilityLabel(p9f("p9.consent.withdraw_a11y", consent.purposeTitle))
                }
            } else {
                V7Pill(text: p9("p9.consent.off"), kind: .neutral)
            }
        }
        .padding(.vertical, 6)
    }
}

/// "Record a consent": what for, how it was given, an optional note; the current notice is shown first.
struct RecordConsentSheet: View {
    let holder: ConsentsStateHolder
    let loaded: ConsentsStateLoaded
    let onDone: () -> Void
    @State private var purpose: ConsentPurpose
    @State private var method: ConsentMethod
    @State private var note: String
    @State private var sent = false
    @Environment(\.skTheme) private var theme

    init(holder: ConsentsStateHolder, loaded: ConsentsStateLoaded, onDone: @escaping () -> Void) {
        self.holder = holder
        self.loaded = loaded
        self.onDone = onDone
        let failed = loaded.failedRecord
        _purpose = State(initialValue: failed?.purpose ?? ConsentPurpose.care)
        _method = State(initialValue: failed?.method ?? ConsentMethod.verbal)
        _note = State(initialValue: failed?.note ?? "")
    }

    var body: some View {
        let r = theme.roles
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                SkSheetHeader(p9("p9.consent.record"), subtitle: p9("p9.consent.record.sub"))
                if let notice = loaded.notices.max(by: { $0.version < $1.version }) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(notice.label).v7Text(13, .bold)
                        Text(notice.body).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
                    }
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
                V7Label(text: p9("p9.consent.for"))
                SkChoiceChips(Array(ConsentPurpose.allCases), selected: [purpose], label: { $0.title }) { purpose = $0 }
                V7Label(text: p9("p9.consent.how"))
                SkChoiceChips(Array(ConsentMethod.allCases), selected: [method], label: { $0.title }) { method = $0 }
                SkField(p9("p9.consent.note"), text: $note)
                if let error = loaded.failedRecord?.error ?? loaded.error {
                    Text(error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                }
                SkPillButton(p9("p9.consent.save"), wide: true, loading: loaded.busy) {
                    sent = true
                    holder.record(purpose: purpose, method: method, note: note.isEmpty ? nil : note)
                }
            }
            .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
        .skSheet()
        .onChange(of: loaded.busy) { old, new in
            if sent, old, !new, loaded.failedRecord == nil, loaded.error == nil { onDone() }
        }
    }
}
