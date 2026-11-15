import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// The patient's closed visits from every clinic, newest first.
struct VisitsScreen: View {
    let graph: PatientGraph

    var body: some View {
        ScreenHost(make: { graph.visits(screen: $0) }, state: { $0.state }) { holder, state in
            ListContent(state: state, retry: holder.refresh, empty: "visits.empty") { (items: [VisitView]) in
                ForEach(items, id: \.id) { visit in
                    NavigationLink(value: Route.visit(visit.id)) { VisitRow(visit: visit) }
                        .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle(String(localized: "visits.title"))
    }
}

private struct VisitRow: View {
    let visit: VisitView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let p = theme.palette
        let treatments = visit.treatments.prefix(3).map(\.name).joined(separator: ", ")
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.xs) {
                Text(ClinicFormat.date(iso: visit.visitedOn)).skTextStyle(SkTypeScale.headline).foregroundStyle(p.text.color)
                Text(VisitCopy.whoAndWhere(doctor: visit.doctorName, clinic: visit.clinicName))
                    .skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
                if !treatments.isEmpty {
                    Text(treatments).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.text.color)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityHint(String(localized: "visits.open_hint"))
    }
}

/// One visit: treatments, advice, prescription, next follow-up (with Book) and earlier visits.
struct VisitScreen: View {
    let graph: PatientGraph
    let id: String
    let onBook: (VisitView) -> Void

    var body: some View {
        ScreenHost(make: { graph.visit(screen: $0, id: id) }, state: { $0.state }) { holder, state in
            VisitContent(holder: holder, state: state, onBook: onBook)
        }
        .navigationTitle(String(localized: "visit.title"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct VisitContent: View {
    let holder: VisitStateHolder
    let state: VisitState
    let onBook: (VisitView) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                switch onEnum(of: state) {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .failed(let failed):
                    if failed.error == .notFound {
                        SkEmptyState(String(localized: "visit.not_found"), message: "")
                    } else {
                        SkEmptyState(failed.error.message, message: "", actionTitle: String(localized: "try_again"), action: holder.refresh)
                    }
                case .loaded(let loaded):
                    VisitSections(visit: loaded.visit, onBook: onBook)
                }
            }
            .padding(SkSpacing.l)
        }
        .refreshable { holder.refresh() }
    }
}

/// The sections in the order a patient reads them; empty ones are not shown.
private struct VisitSections: View {
    let visit: VisitView
    let onBook: (VisitView) -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        let p = theme.palette
        SkHeroCard(
            kicker: ClinicFormat.date(iso: visit.visitedOn),
            title: visit.clinicName,
            subtitle: visit.doctorName.map { String(format: String(localized: "visit.doctor"), $0) } ?? ""
        )
        if !visit.treatments.isEmpty {
            section("visit.treatments") {
                ForEach(Array(visit.treatments.enumerated()), id: \.offset) { _, treatment in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(treatment.name).skTextStyle(SkTypeScale.label).foregroundStyle(p.text.color)
                        if let detail = VisitCopy.toothText(tooth: treatment.tooth?.intValue, surfaces: treatment.surfaces) {
                            Text(detail).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        if let advice = visit.advice {
            section("visit.advice") { Text(advice).skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color) }
        }
        if let rx = visit.prescription {
            section("visit.prescription") {
                Text("\(rx.number) · \(ClinicFormat.date(iso: rx.issuedOn))").skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                ForEach(Array(rx.medicines.enumerated()), id: \.offset) { _, medicine in
                    VStack(alignment: .leading, spacing: 2) {
                        Text([medicine.name, medicine.strength].compactMap { $0 }.joined(separator: " "))
                            .skTextStyle(SkTypeScale.label).foregroundStyle(p.text.color)
                        Text(medicine.detailsText).skTextStyle(SkTypeScale.footnote).foregroundStyle(p.textMuted.color)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        if let next = visit.nextFollowUp {
            section("visit.next") {
                Text(String(format: String(localized: "visit.next_due"), VisitCopy.kind(next.kind), ClinicFormat.date(iso: next.dueOn)))
                    .skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color)
                if visit.clinicId != nil || visit.bookingUrl != nil {
                    SkButton(String(localized: "visit.book"), systemImage: "calendar.badge.plus") { book() }
                        .accessibilityHint(String(format: String(localized: "visit.book_hint"), visit.clinicName))
                }
            }
        }
        if !visit.earlierVisits.isEmpty {
            section("visit.earlier") {
                ForEach(Array(visit.earlierVisits.enumerated()), id: \.offset) { _, earlier in
                    HStack(alignment: .firstTextBaseline) {
                        Text(ClinicFormat.date(iso: earlier.visitedOn)).foregroundStyle(p.textMuted.color)
                        Spacer(minLength: SkSpacing.sm)
                        Text(earlier.title).multilineTextAlignment(.trailing).foregroundStyle(p.text.color)
                    }
                    .skTextStyle(SkTypeScale.footnote)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }

    /// In-app booking for the visit's clinic; the clinic's booking page when the app can't.
    private func book() {
        if visit.clinicId != nil {
            onBook(visit)
        } else if let url = visit.bookingUrl.flatMap(URL.init(string:)) {
            openURL(url)
        }
    }

    private func section<Content: View>(_ key: String.LocalizationValue, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: SkSpacing.sm) {
            Text(String(localized: key)).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
                .accessibilityAddTraits(.isHeader)
            SkCard {
                VStack(alignment: .leading, spacing: SkSpacing.sm) { content() }
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

/// Visit copy that has no place in shared code.
enum VisitCopy {
    static func whoAndWhere(doctor: String?, clinic: String) -> String {
        guard let doctor else { return clinic }
        return String(format: String(localized: "visit.with_at"), doctor, clinic)
    }

    /// `Tooth 16 · O, D`; nil when the treatment names neither.
    static func toothText(tooth: Int?, surfaces: [String]) -> String? {
        var parts: [String] = []
        if let tooth { parts.append(String(format: String(localized: "visit.tooth"), tooth)) }
        if !surfaces.isEmpty { parts.append(surfaces.joined(separator: ", ")) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    static func kind(_ value: String) -> String {
        switch value {
        case "follow_up": String(localized: "visit.kind.follow_up")
        case "cleaning": String(localized: "visit.kind.cleaning")
        default: String(localized: "visit.kind.other")
        }
    }
}
