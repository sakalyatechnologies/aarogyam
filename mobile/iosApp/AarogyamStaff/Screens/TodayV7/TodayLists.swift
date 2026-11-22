import AarogyamShared
import SakalyaUI
import SwiftUI

/// The "Up next" carousel: calm solid cards, the first one wider and tinted (`.car`).
struct UpNextCarousel: View {
    let items: [ScheduleItem]
    let onOpen: (ScheduleItem) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(Array(items.enumerated()), id: \.element.appointmentId) { index, item in
                    let first = index == 0
                    let ink = (first ? r.onPrimaryContainer : r.onSurface).color
                    Button { onOpen(item) } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            GroupedAvatar(name: item.patientName)
                            Text(item.patientName).font(.subheadline.weight(.semibold)).lineLimit(1)
                            Text([TodayV7.clock(minuteOfDay: Int(item.starts.minuteOfDay)), item.reason].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption).opacity(0.85).lineLimit(2).multilineTextAlignment(.leading)
                        }
                        .foregroundStyle(ink)
                        .padding(12)
                        .frame(width: first ? TodaySizes.carouselFirst : TodaySizes.carouselCard, alignment: .leading)
                        .background((first ? r.primaryContainer : r.card).color, in: RoundedRectangle(cornerRadius: GroupedSizes.radius, style: .continuous))
                    }
                    .buttonStyle(.skPressable)
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
    }
}

/// The day's schedule as one inset-grouped card: time, patient and reason, and a status pill.
struct TodaySchedule: View {
    let items: [ScheduleItem]
    let onOpen: (ScheduleItem) -> Void
    @Environment(\.skTheme) private var theme
    @ScaledMetric(relativeTo: .subheadline) private var timeWidth: CGFloat = 46

    var body: some View {
        let r = theme.roles
        GroupedRows(items: items, inset: GroupedSizes.rowPaddingH + timeWidth + 12) { item in
            Button { onOpen(item) } label: {
                HStack(spacing: 12) {
                    Text(TodayV7.clock(minuteOfDay: Int(item.starts.minuteOfDay)))
                        .font(.system(.subheadline, design: .monospaced).weight(.semibold)).monospacedDigit()
                        .foregroundStyle(r.onSurfaceVariant.color).frame(minWidth: timeWidth, alignment: .leading)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.patientName).font(.body.weight(.semibold)).foregroundStyle(r.onSurface.color).lineLimit(1)
                        if let reason = item.reason {
                            Text(reason).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                    GroupedPill(text: TodayV7.Pill(item.status).label, kind: TodaySchedule.kind(TodayV7.Pill(item.status)))
                }
                .accessibilityElement(children: .combine)
            }
            .buttonStyle(GroupedRowStyle())
        }
    }

    /// In chair is strong, waiting warm, done quiet, missed an error, booked an outline.
    static func kind(_ pill: TodayV7.Pill) -> GroupedPill.Kind {
        switch pill {
        case .done: .neutral
        case .inChair: .strong
        case .waiting: .warm
        case .missed: .error
        case .booked: .outline
        }
    }
}

/// Late arrivals and long waits, from the server, as one grouped card.
struct AttentionList: View {
    let items: [AttentionView]
    let onOpen: (AttentionView) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        GroupedRows(items: items) { item in
            Button { onOpen(item) } label: {
                HStack(spacing: 12) {
                    Image(systemName: "exclamationmark").font(.body.weight(.heavy)).foregroundStyle(r.onErrorContainer.color)
                        .frame(width: 40, height: 40)
                        .background(r.errorContainer.color, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(TodayV7.attentionTitle(kind: item.kind, minutes: Int(item.minutes)))
                            .font(.body.weight(.semibold)).foregroundStyle(r.onSurface.color)
                        Text(item.patientName).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(r.onSurfaceVariant.color)
                        .accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
            }
            .buttonStyle(GroupedRowStyle())
        }
    }
}
