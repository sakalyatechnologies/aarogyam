import AarogyamShared
import SakalyaUI
import SwiftUI

/// Where the Visit screen opens: from the queue's Start treatment or a patient's page. Carries
/// IDs only, never a name.
struct VisitRoute: Hashable {
    let patientId: String
    var tokenId: String?
    var appointmentId: String?
}

/// Start treatment and the Visit screen: the patient and a running timer, quick note bullets
/// (typed or dictated), autosave state, then Sign and Close. The state holder starts the visit
/// when this screen appears (from the queue token when there is one).
struct VisitScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute

    var body: some View {
        ScreenHost(make: { graph.patient360(clinic: clinic, patientId: route.patientId, screen: $0) }, state: { $0.state }) { _, patient in
            ScreenHost(
                make: { graph.visit(clinic: clinic, patientId: route.patientId, tokenId: route.tokenId, appointmentId: route.appointmentId, screen: $0) },
                state: { $0.state }
            ) { holder, state in
                VisitBody(graph: graph, clinic: clinic, route: route, holder: holder, state: state, patient: patient)
            }
        }
        .navigationTitle(CL("c.visit.title"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(false)
    }
}

private struct VisitBody: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let route: VisitRoute
    let holder: VisitStateHolder
    let state: VisitState
    let patient: Patient360State
    @Environment(\.skTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                switch onEnum(of: state) {
                case .starting:
                    SkLoadingIndicator(CL("c.visit.starting")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(CL("c.visit.not_allowed.title"), message: CL("c.visit.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(CL("c.visit.title"), message: failed.error.message)
                case .open(let open):
                    if open.view.closed {
                        VisitClosedView(number: open.view.number) { dismiss() }
                    } else {
                        VisitHeader(view: open.view, patient: patient)
                        VisitNotesPanel(graph: graph, clinic: clinic, route: route, holder: holder, view: open.view, patient: patient)
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.roles.background.color)
    }
}

/// The patient, the visit number and the timer, on the primary container like the hero cards.
private struct VisitHeader: View {
    let view: VisitView_
    let patient: Patient360State
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: SkSpacing.ml) {
            HStack(spacing: SkSpacing.ml) {
                SkAvatar(person?.name ?? "?", tone: .brand, size: 46, shape: .circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person?.name ?? " ").font(.system(size: 17, weight: .heavy)).foregroundStyle(r.onPrimaryContainer.color)
                    Text(subtitle).font(.system(size: 12.5)).foregroundStyle(r.onPrimaryContainer.color.opacity(0.8))
                }
                Spacer(minLength: 0)
            }
            HStack(alignment: .firstTextBaseline) {
                VisitTimer(startedAt: view.startedAt)
                Spacer(minLength: 0)
                HStack(spacing: 6) {
                    SkLiveDot()
                    Text("c.visit.in_treatment", tableName: "ClinicalV7").font(.system(size: 12, weight: .bold))
                }
                .foregroundStyle(r.onPrimaryContainer.color)
            }
        }
        .padding(SkSpacing.l)
        .background(r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var person: PatientView? {
        if case .loaded(let loaded) = onEnum(of: patient) { loaded.view } else { nil }
    }

    private var subtitle: String {
        var parts = [view.number]
        if let person { parts.insert(patientLine(number: person.number, ageYears: person.ageYears?.intValue, sex: person.sex), at: 0) }
        return parts.joined(separator: " · ")
    }
}

/// The running time since the visit started, ticking every second.
struct VisitTimer: View {
    let startedAt: KotlinInstant?
    @Environment(\.skTheme) private var theme

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = startedAt.map { Int(context.date.timeIntervalSince1970) - Int($0.epochSeconds) } ?? 0
            Text(ClinicalFormat.timer(seconds: seconds))
                .font(.system(size: 38, weight: .heavy)).monospacedDigit()
                .foregroundStyle(theme.roles.onPrimaryContainer.color)
                .minimumScaleFactor(0.6).lineLimit(1)
                .accessibilityLabel(CLf("c.visit.timer.a11y", seconds / 60))
        }
    }
}

private struct VisitClosedView: View {
    let number: String
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: SkSpacing.l) {
            SkCheckDraw()
            SkSheetHeader(CL("c.visit.closed.title"), subtitle: number).multilineTextAlignment(.center)
            SkPillButton(CL("c.done"), wide: true, action: onDone)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, SkSpacing.xxxl)
    }
}
