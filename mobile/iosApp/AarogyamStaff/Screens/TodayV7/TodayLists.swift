import AarogyamShared
import SakalyaUI
import SwiftUI

/// The "Up next" carousel: the first card wider and tinted (`.car`).
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
                            InitialsAvatar(name: item.patientName, size: 42, cool: index % 2 == 1)
                            Text(item.patientName).font(.system(size: 12.5, weight: .bold)).lineLimit(1)
                            Text([TodayV7.clock(minuteOfDay: Int(item.starts.minuteOfDay)), item.reason].compactMap { $0 }.joined(separator: " · "))
                                .font(.system(size: 11)).opacity(0.8).lineLimit(2).multilineTextAlignment(.leading)
                        }
                        .foregroundStyle(ink)
                        .padding(10)
                        .frame(width: first ? TodaySizes.carouselFirst : TodaySizes.carouselCard, alignment: .leading)
                        .background((first ? r.primaryContainer : r.card).color, in: RoundedRectangle(cornerRadius: TodaySizes.carouselRadius, style: .continuous))
                    }
                    .buttonStyle(.skPressable)
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
    }
}

/// The day's schedule as a joined list with times and status pills.
struct TodaySchedule: View {
    let items: [ScheduleItem]
    let onOpen: (ScheduleItem) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: 3) {
            ForEach(Array(items.enumerated()), id: \.element.appointmentId) { index, item in
                JoinedRow(index: index, count: items.count, action: { onOpen(item) }) {
                    Text(TodayV7.clock(minuteOfDay: Int(item.starts.minuteOfDay)))
                        .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(theme.roles.onSurfaceVariant.color).frame(minWidth: 42, alignment: .leading)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(item.patientName).font(.system(size: 13.5, weight: .bold)).foregroundStyle(theme.roles.onSurface.color).lineLimit(1)
                        if let reason = item.reason {
                            Text(reason).font(.system(size: 11.5)).foregroundStyle(theme.roles.onSurfaceVariant.color).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                    StatusPill(pill: TodayV7.Pill(item.status))
                }
            }
        }
    }
}

/// Late arrivals and long waits, from the server.
struct AttentionList: View {
    let items: [AttentionView]
    let onOpen: (AttentionView) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: 3) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                JoinedRow(index: index, count: items.count, action: { onOpen(item) }) {
                    Text("!").font(.system(size: 13, weight: .heavy)).foregroundStyle(r.onErrorContainer.color)
                        .frame(width: TodaySizes.listShape, height: TodaySizes.listShape)
                        .background(r.errorContainer.color, in: Circle())
                    VStack(alignment: .leading, spacing: 0) {
                        Text(TodayV7.attentionTitle(kind: item.kind, minutes: Int(item.minutes)))
                            .font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color)
                        Text(item.patientName).font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
                    }
                    Spacer(minLength: 4)
                    V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color)
                }
            }
        }
    }
}
