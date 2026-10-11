import AarogyamShared
import SakalyaUI
import SwiftUI

/// The designed state of a section that is loading, not allowed or failed (offline reads as its own message).
struct V9SectionState: View {
    enum Kind { case loading, notAllowed, failed(ScreenError) }
    let title: String
    let kind: Kind
    var retry: (() -> Void)?

    var body: some View {
        switch kind {
        case .loading:
            SkLoadingIndicator(p9("p9.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(title, message: p9("p9.not_allowed"))
        case .failed(let error):
            SkEmptyState(
                title,
                message: error == .offline ? p9("p9.offline") : error.message,
                actionTitle: String(localized: "try_again"), action: retry
            )
        }
    }
}

/// A card section title with a muted note on the right (the mockup's `.sech`).
struct V9SectionHead: View {
    let title: String
    var note: String?
    @Environment(\.skTheme) private var theme

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).v7Text(15, .heavy)
                Spacer(minLength: 8)
                if let note { Text(note).v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color) }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title).v7Text(15, .heavy)
                if let note { Text(note).v7Text(12).foregroundStyle(theme.roles.onSurfaceVariant.color) }
            }
        }
        .foregroundStyle(theme.roles.onSurface.color)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The inline error line shown above content that stayed on screen after a failed refresh.
struct V9ErrorLine: View {
    let error: ScreenError
    @Environment(\.skTheme) private var theme

    var body: some View {
        Text(error == .offline ? p9("p9.offline_stale") : error.message)
            .v7Text(12.5).foregroundStyle(theme.roles.error.color)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A round badge with a short label (a tooth number, a check).
struct V9Round: View {
    let text: String
    var tonal = true
    @Environment(\.skTheme) private var theme
    @ScaledMetric private var side: CGFloat = 38

    var body: some View {
        let r = theme.roles
        Text(text).v7Text(13, .heavy)
            .foregroundStyle((tonal ? r.onPrimaryContainer : r.onSurfaceVariant).color)
            .frame(width: side, height: side)
            .background((tonal ? r.primaryContainer : r.surface3).color, in: Circle())
            .accessibilityHidden(true)
    }
}

/// The pill tabs: pinned at the top while the page scrolls; the chosen one is inverted.
struct PatientV9PillTabs: View {
    let tabs: [PatientPageTab]
    let selection: PatientPageTab
    let historyCount: Int?
    let onSelect: (PatientPageTab) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tabs, id: \.self) { tab in
                    let on = tab == selection
                    Button { onSelect(tab) } label: {
                        Text(tab.title(historyCount: historyCount)).v7Text(12.5, .bold)
                            .foregroundStyle((on ? r.background : r.onSurfaceVariant).color)
                            .padding(.horizontal, 14).frame(minHeight: 34)
                            .background((on ? r.onSurface : r.surface2).color, in: Capsule())
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.skPressable)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.horizontal, SkSpacing.l)
        }
        .padding(.top, 9).padding(.bottom, 1)
        .background(r.background.color)
    }
}

/// The header's money strip: closed by default ("Tap to show"), then three cells and an eye-off button.
/// It is not drawn at all when the role has no money.
struct PatientMoneyStrip: View {
    let model: MoneyStripModel
    let toggle: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        switch model {
        case .none:
            EmptyView()
        case .closed:
            Button(action: toggle) {
                HStack(spacing: 10) {
                    Image(systemName: "eye").imageScale(.medium)
                    Text(p9("p9.money.title")).v7Text(13.5, .bold)
                    Spacer(minLength: 6)
                    Text(p9("p9.money.tap")).v7Text(12, .semibold).opacity(0.75)
                }
                .foregroundStyle(r.onPrimaryContainer.color)
                .padding(.horizontal, 14).frame(minHeight: 46)
                .frame(maxWidth: .infinity)
                .background(r.background.color.opacity(0.55), in: Capsule())
            }
            .buttonStyle(.skPressable)
            .accessibilityLabel(p9("p9.money.title"))
            .accessibilityHint(p9("p9.money.show_hint"))
        case .open(let visits, let paid, let due, let hasDue):
            HStack(spacing: 6) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 14) { cells(visits, paid, due, hasDue) }
                    VStack(alignment: .leading, spacing: 6) { cells(visits, paid, due, hasDue) }
                }
                Spacer(minLength: 0)
                Button(action: toggle) {
                    Image(systemName: "eye.slash").frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.skPressable)
                .accessibilityLabel(p9("p9.money.hide"))
            }
            .foregroundStyle(r.onPrimaryContainer.color)
            .padding(.leading, 14).padding(.trailing, 4).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(r.background.color.opacity(0.55), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .accessibilityElement(children: .contain)
        }
    }

    @ViewBuilder private func cells(_ visits: String, _ paid: String, _ due: String, _ hasDue: Bool) -> some View {
        cell(p9("p9.money.visits"), visits, tone: nil)
        cell(p9("p9.money.paid"), paid, tone: nil)
        cell(p9("p9.money.due"), due, tone: hasDue ? theme.roles.tertiary.color : nil)
    }

    private func cell(_ label: String, _ value: String, tone: Color?) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label).v7Text(11, .bold).opacity(0.8)
            Text(value).v7Text(16, .heavy).foregroundStyle(tone ?? theme.roles.onPrimaryContainer.color).lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}
