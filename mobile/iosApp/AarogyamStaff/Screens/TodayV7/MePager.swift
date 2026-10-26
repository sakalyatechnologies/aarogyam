import AarogyamShared
import SakalyaUI
import SwiftUI

/// What the me card shows; built from the shared MeView (or from the money for finance).
struct MeCardModel {
    let role: String
    let name: String
    let chips: [String]
    let progress: Progress?

    struct Progress {
        let label: String
        let value: String
        /// 0 to 1; nil draws an empty track (the finance month target is a preview).
        let fraction: Double?
        var isPreview = false
    }
}

/// The swipeable pair at the top of Today: the me card and the dark "My schedule" card, with dots.
struct MePager: View {
    let graph: AppGraph
    let model: MeCardModel
    /// The dark card; nil for finance, which has no visits of its own.
    let schedule: MySchedule?
    let onEditAvatar: () -> Void
    let onOpen: (ScheduleItem) -> Void
    @State private var page: Int? = 0
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: SkSpacing.m) {
                    MeCard(graph: graph, model: model, onEditAvatar: onEditAvatar)
                        .containerRelativeFrame(.horizontal).id(0)
                    if let schedule {
                        MyScheduleCard(schedule: schedule, onOpen: onOpen)
                            .containerRelativeFrame(.horizontal).id(1)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $page)
            if schedule != nil {
                HStack(spacing: 5) {
                    ForEach(0..<2, id: \.self) { index in
                        Capsule()
                            .fill(index == (page ?? 0) ? theme.roles.primary.color : theme.roles.outline.color)
                            .frame(width: index == (page ?? 0) ? 18 : 6, height: 6)
                            .animation(SkMotionTokens.pressSpring.animation, value: page)
                    }
                }
                .accessibilityHidden(true)
            }
        }
    }
}

/// The member's own day for the dark card.
struct MySchedule {
    let iso: String
    let rows: [ScheduleItem]
}

private struct MeCard: View {
    let graph: AppGraph
    let model: MeCardModel
    let onEditAvatar: () -> Void
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var grown = false

    var body: some View {
        let r = theme.roles
        let ink = r.onPrimaryContainer.color
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                SkAvatarFrame(shape: .circle, size: 76, background: Color.white.opacity(0.55)) { MyAvatar(graph: graph) }
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.role).font(.system(size: 11, weight: .bold)).opacity(0.75)
                    Text("t7.me.hello \(model.name)", tableName: "TodayV7")
                        .font(.system(size: 19, weight: .heavy)).tracking(-0.3).lineSpacing(0)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(ink)
                Spacer(minLength: 0)
            }
            FlowLayout(spacing: 6) {
                ForEach(model.chips, id: \.self) { chip in
                    Text(chip).font(.system(size: 11, weight: .bold)).foregroundStyle(ink)
                        .padding(.horizontal, 9).padding(.vertical, 5)
                        .background(Color.white.opacity(0.6), in: Capsule())
                }
            }
            Spacer(minLength: 0)
            if let progress = model.progress { dayProgress(progress, ink: ink) }
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            ZStack(alignment: .bottomTrailing) {
                LinearGradient(
                    colors: [r.primaryContainer.color, r.primaryContainer.mixed(with: r.tertiaryContainer, weight: 0.55).color],
                    startPoint: UnitPoint(x: 0.25, y: 0), endPoint: UnitPoint(x: 0.75, y: 1)
                )
                SkMorphingBlob(color: r.primary.color.opacity(0.08), periodMs: 9000)
                    .frame(width: 160, height: 160).offset(x: 50, y: 60)
            }
        }
        .overlay(alignment: .topTrailing) {
            Button(action: onEditAvatar) {
                V7Icon(name: "spark", size: 19, tint: ink).frame(width: 36, height: 36)
                    .background(Color.white.opacity(0.55), in: Circle())
            }
            .buttonStyle(.skPressable)
            .padding(10)
            .accessibilityLabel(String(localized: "t7.me.change_avatar", table: "TodayV7"))
        }
        .clipShape(RoundedRectangle(cornerRadius: TodaySizes.cardRadius, style: .continuous))
    }

    private func dayProgress(_ progress: MeCardModel.Progress, ink: Color) -> some View {
        VStack(spacing: 5) {
            HStack {
                Text(progress.label)
                Spacer(minLength: SkSpacing.s)
                Text(progress.value).multilineTextAlignment(.trailing)
            }
            .font(.system(size: 11, weight: .bold)).foregroundStyle(ink.opacity(0.85))
            GeometryReader { box in
                Capsule().fill(Color.white.opacity(0.55))
                    .overlay(alignment: .leading) {
                        Capsule().fill(theme.roles.primary.color)
                            .frame(width: box.size.width * (progress.fraction ?? 0) * ((grown || reduceMotion) ? 1 : 0))
                    }
            }
            .frame(height: 8)
            if progress.isPreview { PreviewNotice().scaleEffect(0.9, anchor: .leading) }
        }
        .onAppear { withAnimation(SkMotionTokens.emphasized.animation(duration: 1.2).delay(0.3)) { grown = true } }
    }
}

private struct MyScheduleCard: View {
    let schedule: MySchedule
    let onOpen: (ScheduleItem) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let ink = r.onInverseSurface.color
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("t7.me.my_schedule", tableName: "TodayV7").font(.system(size: 16, weight: .heavy))
                Spacer()
                Text(TodayV7.monthYear(iso: schedule.iso)).font(.system(size: 11)).opacity(0.65)
            }
            HStack {
                ForEach(Array(TodayV7.weekStrip(iso: schedule.iso).enumerated()), id: \.offset) { _, day in
                    VStack(spacing: 4) {
                        Text(day.letter).font(.system(size: 10)).opacity(day.isToday ? 1 : 0.6)
                        Text("\(day.number)").font(.system(size: 13, weight: .bold)).monospacedDigit()
                            .foregroundStyle(day.isToday ? r.onPrimaryContainer.color : ink.opacity(0.6))
                            .frame(width: 30, height: 30)
                            .background(day.isToday ? r.primaryContainer.color : .clear, in: Circle())
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .accessibilityHidden(true)
            if schedule.rows.isEmpty {
                Text("t7.me.nothing_left", tableName: "TodayV7").font(.system(size: 11.5)).opacity(0.6)
            }
            ForEach(Array(schedule.rows.enumerated()), id: \.element.appointmentId) { index, item in
                Button { onOpen(item) } label: {
                    HStack(spacing: 10) {
                        InitialsAvatar(name: item.patientName, size: 36, cool: true)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(item.patientName).font(.system(size: 12.5, weight: .bold)).lineLimit(1)
                            if let reason = item.reason { Text(reason).font(.system(size: 11)).opacity(0.6).lineLimit(1) }
                        }
                        Spacer(minLength: 4)
                        let time = TodayV7.clock(minuteOfDay: Int(item.starts.minuteOfDay))
                        Text(index == 0 ? String(format: String(localized: "t7.me.next_at", table: "TodayV7"), time) : time)
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundStyle(index == 0 ? Color.white : ink.opacity(0.8))
                            .padding(.horizontal, 7).padding(.vertical, 4)
                            .background(index == 0 ? r.tertiary.color : Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .foregroundStyle(ink)
        .padding(.init(top: 14, leading: 14, bottom: 10, trailing: 14))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(r.inverseSurface.color, in: RoundedRectangle(cornerRadius: TodaySizes.cardRadius, style: .continuous))
    }
}
