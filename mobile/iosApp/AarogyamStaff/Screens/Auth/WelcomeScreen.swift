import AarogyamShared
import SakalyaUI
import SwiftUI

/// What the signed-out person sees first: three illustrated slides, dots, "Get started" and
/// "I have a clinic invite" (`.welcome`).
struct WelcomeScreen: View {
    let onGetStarted: () -> Void
    let onInvite: () -> Void
    @State private var page: Int? = 0
    @Environment(\.skTheme) private var theme

    private static let slides: [WelcomeSlide] = [
        .init(art: "tooth", warm: false, title: "t7.welcome.1.title", message: "t7.welcome.1.message"),
        .init(art: "family", warm: true, title: "t7.welcome.2.title", message: "t7.welcome.2.message"),
        .init(art: "implant", warm: true, title: "t7.welcome.3.title", message: "t7.welcome.3.message"),
    ]

    var body: some View {
        let r = theme.roles
        VStack(spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 0) {
                    ForEach(Array(Self.slides.enumerated()), id: \.offset) { index, slide in
                        WelcomeSlideView(slide: slide).containerRelativeFrame(.horizontal).id(index)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $page)
            VStack(spacing: 10) {
                HStack(spacing: 6) {
                    ForEach(0..<Self.slides.count, id: \.self) { index in
                        Capsule().fill(index == (page ?? 0) ? r.primary.color : r.outline.color)
                            .frame(width: index == (page ?? 0) ? 24 : 7, height: 7)
                            .animation(SkMotionTokens.pressSpring.animation, value: page)
                    }
                }
                .padding(.bottom, 6)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(String(format: String(localized: "t7.welcome.page", table: "TodayV7"), (page ?? 0) + 1, Self.slides.count))
                SkPillButton(String(localized: "t7.welcome.get_started", table: "TodayV7"), wide: true, action: onGetStarted)
                SkPillButton(String(localized: "t7.welcome.invite", table: "TodayV7"), variant: .ghost, wide: true, action: onInvite)
            }
            .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 24)
        }
        .background {
            RadialGradient(
                colors: [r.primary.mixed(with: r.background, weight: 0.26).color, r.background.color],
                center: .top, startRadius: 0, endRadius: 620
            )
            .ignoresSafeArea()
        }
    }
}

struct WelcomeSlide {
    let art: String
    /// The second and third slides use the warm (tertiary) blob.
    let warm: Bool
    let title: String
    let message: String
}

private struct WelcomeSlideView: View {
    let slide: WelcomeSlide
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 22) {
            Spacer(minLength: 0)
            ZStack {
                WelcomeBlob(warm: slide.warm)
                if let piece = IllustrationArt.shared.all[slide.art] {
                    ArtView(piece: piece).frame(width: 232, height: 205)
                }
                Circle().fill(r.tertiaryContainer.color).frame(width: 46, height: 46)
                    .offset(x: 100, y: -88).skLoop(SkLoopTokens.float)
                Circle().fill(r.primaryContainer.color).frame(width: 28, height: 28)
                    .offset(x: -104, y: 80).skLoop(SkLoopTokens.float, offsetMs: -2000)
            }
            .frame(width: 220, height: 220).frame(maxWidth: .infinity)
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 8) {
                Text(LocalizedStringKey(slide.title), tableName: "TodayV7")
                    .font(.system(size: 31, weight: .heavy)).tracking(-0.8).foregroundStyle(r.onSurface.color)
                    .fixedSize(horizontal: false, vertical: true).accessibilityAddTraits(.isHeader)
                Text(LocalizedStringKey(slide.message), tableName: "TodayV7")
                    .font(.system(size: 15)).foregroundStyle(r.onSurfaceVariant.color).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 26).padding(.top, 70)
    }
}

/// The slide's morphing blob: brand gradient, or the warm one from slide two on.
private struct WelcomeBlob: View {
    let warm: Bool
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let r = theme.roles
        TimelineView(.animation(paused: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate * 1000 / 9000
            let fraction = t - t.rounded(.down)
            SkBlobShape(SkBlobRadii.morph(fraction))
                .fill(LinearGradient(
                    colors: warm ? [r.tertiary.color, r.tertiary.mixed(with: SkRGB(0xFFD1A6), weight: 0.6).color] : [r.primary.color, r.primary2.color],
                    startPoint: UnitPoint(x: 0.2, y: 0), endPoint: UnitPoint(x: 0.8, y: 1)
                ))
                .shadow(color: (warm ? r.tertiary : r.primary).color.opacity(0.4), radius: 24, y: 24)
        }
        .accessibilityHidden(true)
    }
}

/// The spinner screen between sign-in and the app: "Opening <clinic>".
struct OpeningClinicScreen: View {
    let clinicName: String
    let role: String
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: 18) {
            SkSpinningShape(shape: .rounded, size: 84) {
                Text(Initials.of(clinicName)).font(.system(size: 24, weight: .heavy)).foregroundStyle(r.onPrimaryContainer.color)
                    .frame(maxWidth: .infinity, maxHeight: .infinity).background(r.primaryContainer.color)
            }
            VStack(spacing: 4) {
                Text(String(format: String(localized: "t7.opening.title", table: "TodayV7"), clinicName))
                    .font(.system(size: 20, weight: .heavy)).foregroundStyle(r.onSurface.color).multilineTextAlignment(.center)
                Text(String(format: String(localized: "t7.opening.role", table: "TodayV7"), role))
                    .font(.system(size: 13)).foregroundStyle(r.onSurfaceVariant.color)
            }
        }
        .padding(SkSpacing.xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(r.background.color.ignoresSafeArea())
        .accessibilityElement(children: .combine)
    }
}
