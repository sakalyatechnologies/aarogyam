import AarogyamShared
import SakalyaUI
import SwiftUI

/// The top of the visit: a live pill, who the patient is, a big timer and the allergy banner.
/// It runs under the (clear) navigation bar like the mockup's `.vhead`.
struct V9Header: View {
    let view: VisitView_
    let patient: Patient360State
    let chair: Int?
    let closed: Bool
    @Environment(\.skTheme) private var theme
    @ScaledMetric(relativeTo: .largeTitle) private var timerSize: CGFloat = 56

    var body: some View {
        let r = theme.roles
        let ink = r.onPrimaryContainer.color
        VStack(spacing: SkSpacing.m) {
            if !closed {
                HStack {
                    livePill
                    Spacer(minLength: 0)
                }
            }
            HStack(spacing: SkSpacing.ml) {
                V7Initials(name: person?.name ?? "?", size: 46, strong: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(person?.name ?? " ").v7Text(17, .heavy).foregroundStyle(ink).lineLimit(2)
                    Text(subtitle).v7Text(12.5).foregroundStyle(ink.opacity(0.85)).lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            if closed {
                SkCheckDraw()
                Text("v9v.closed.title", tableName: "VisitV9").v7Text(24, .heavy).foregroundStyle(ink)
            } else {
                V9Timer(startedAt: view.startedAt, size: timerSize)
                if let started = startedText {
                    Text(started).v7Text(12.5).foregroundStyle(ink.opacity(0.85))
                }
            }
            ForEach(Array(allergies.enumerated()), id: \.offset) { _, allergy in
                Text(V9f("v9v.allergy.banner", allergy.substance, allergy.severity.label))
                    .v7Text(13, .bold).multilineTextAlignment(.center)
                    .foregroundStyle(r.onErrorContainer.color)
                    .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity)
                    .background(r.errorContainer.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityLabel(V9f("v9v.allergy.a11y", allergy.substance, allergy.severity.label))
            }
        }
        .padding(.horizontal, SkSpacing.l).padding(.top, SkSpacing.sm).padding(.bottom, 18)
        .frame(maxWidth: .infinity)
        .background(alignment: .top) {
            UnevenRoundedRectangle(bottomLeadingRadius: 32, bottomTrailingRadius: 32, style: .continuous)
                .fill(LinearGradient(colors: [r.primaryContainer.color, r.primaryContainer.color, r.tertiaryContainer.color], startPoint: .topLeading, endPoint: .bottomTrailing))
                .ignoresSafeArea(edges: .top)
        }
        .tint(ink)
    }

    private var livePill: some View {
        let r = theme.roles
        return HStack(spacing: 6) {
            SkLiveDot()
            Text(chair.map { V9f("v9v.live.chair", $0) } ?? CL("c.visit.in_treatment")).v7Text(12, .bold)
        }
        .foregroundStyle(r.onPrimaryContainer.color)
        .padding(.horizontal, 12).padding(.vertical, 6)
        .background(r.card.color.opacity(0.55), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var person: PatientView? {
        if case .loaded(let loaded) = onEnum(of: patient) { loaded.view } else { nil }
    }

    private var allergies: [AllergyView] { person?.flags.allergies ?? [] }

    private var subtitle: String {
        var parts = [view.number]
        if let person { parts.insert(patientLine(number: person.number, ageYears: person.ageYears?.intValue, sex: person.sex), at: 0) }
        return parts.joined(separator: " · ")
    }

    private var startedText: String? {
        view.startedAt.map { V9f("v9v.started", Date(timeIntervalSince1970: TimeInterval($0.epochSeconds)).formatted(date: .omitted, time: .shortened)) }
    }
}

/// The running time since the visit started, ticking every second.
struct V9Timer: View {
    let startedAt: KotlinInstant?
    let size: CGFloat
    @Environment(\.skTheme) private var theme

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let seconds = startedAt.map { Int(context.date.timeIntervalSince1970) - Int($0.epochSeconds) } ?? 0
            Text(ClinicalFormat.timer(seconds: seconds))
                .font(.system(size: size, weight: .heavy, design: .monospaced)).monospacedDigit()
                .foregroundStyle(theme.roles.onPrimaryContainer.color)
                .minimumScaleFactor(0.5).lineLimit(1)
                .accessibilityLabel(CLf("c.visit.timer.a11y", seconds / 60))
        }
    }
}

/// Shown when the phone has no connection: notes keep saving on screen and go when it returns.
struct V9OfflineBanner: View {
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(alignment: .top, spacing: SkSpacing.m) {
            Image(systemName: "wifi.slash").foregroundStyle(r.onTertiaryContainer.color)
            Text("v9v.offline", tableName: "VisitV9").v7Text(13, .semibold).foregroundStyle(r.onTertiaryContainer.color)
            Spacer(minLength: 0)
        }
        .padding(SkSpacing.ml)
        .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
