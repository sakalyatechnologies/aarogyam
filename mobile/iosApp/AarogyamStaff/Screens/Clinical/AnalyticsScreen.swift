import AarogyamShared
import SakalyaUI
import SwiftUI

/// The Analytics page: the range chips (Week, Month, Year, Custom), then cards for money, patients,
/// chairs and mix. The shared `AnalyticsStateHolder` does every total, delta and percentage.
struct AnalyticsScreen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let holder: AnalyticsStateHolder
    let state: AnalyticsState
    @State private var addExpense = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if let range = Self.range(of: state) {
                    RangeControls(holder: holder, range: range)
                }
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(CL("c.loading")).frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                case .notAllowed:
                    SkEmptyState(CL("c.analytics.not_allowed.title"), message: CL("c.analytics.not_allowed.message"))
                case .failed(let failed):
                    SkEmptyState(CL("c.analytics.title"), message: failed.error.message, actionTitle: String(localized: "try_again"), action: holder.refresh)
                case .loaded(let loaded):
                    if loaded.view.isEmpty {
                        SkEmptyState(a11("a11.empty.title"), message: a11("a11.empty.message"))
                    } else {
                        AnalyticsCards(view: loaded.view, onAddExpense: clinic.permissions.contains("expenses.write") ? { addExpense = true } : nil)
                    }
                }
            }
            .padding(.horizontal, SkSpacing.l)
            .padding(.bottom, SkSpacing.xxl)
        }
        .background(theme.roles.background.color)
        .navigationTitle(CL("c.analytics.title"))
        .refreshable { holder.refresh() }
        .sheet(isPresented: $addExpense) { ExpenseSheetHost(graph: graph, clinic: clinic) { holder.refresh() } }
    }

    /// The range the page shows or is loading; nil when the role may not see Analytics.
    static func range(of state: AnalyticsState) -> AnalyticsRange? {
        switch onEnum(of: state) {
        case .loading(let loading): loading.range
        case .failed(let failed): failed.range
        case .loaded(let loaded): loaded.view.range
        case .notAllowed: nil
        }
    }
}

/// The preset chips, and for Custom the From and To pickers (at most two years apart).
private struct RangeControls: View {
    let holder: AnalyticsStateHolder
    let range: AnalyticsRange
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: SkControlSizes.chipGap) {
                ForEach(AnalyticsPreset.allCases, id: \.self) { option in
                    SkChoiceChip(option.label, selected: option == range.preset) { pick(option) }
                }
            }
            if range.preset == .custom {
                HStack(spacing: 12) {
                    picker(a11("a11.range.from"), selection: Binding(get: { AnalyticsFormat.date(range.from) }, set: { holder.showCustom(first: IosDates.parse(AnalyticsFormat.iso($0)), second: range.to) }), bounds: lowerBound...AnalyticsFormat.date(range.to))
                    picker(a11("a11.range.to"), selection: Binding(get: { AnalyticsFormat.date(range.to) }, set: { holder.showCustom(first: range.from, second: IosDates.parse(AnalyticsFormat.iso($0))) }), bounds: AnalyticsFormat.date(range.from)...AnalyticsFormat.date(holder.latestDay))
                }
                Text("a11.range.limit", tableName: "AnalyticsV11").font(.system(size: 11.5)).foregroundStyle(r.onSurfaceVariant.color)
            }
            let ends = AnalyticsFormat.rangeEnds(range)
            Text(AnalyticsFormat.caption(range)).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color)
                .accessibilityLabel(a11f("a11.range.a11y", ends.from, ends.to))
        }
        .padding(.top, 4)
    }

    /// The earliest "from" that keeps the span within the API's limit.
    private var lowerBound: Date {
        Calendar.current.date(byAdding: .day, value: -(Int(holder.maxDays) - 1), to: AnalyticsFormat.date(range.to)) ?? .distantPast
    }

    private func picker(_ title: String, selection: Binding<Date>, bounds: ClosedRange<Date>) -> some View {
        DatePicker(title, selection: selection, in: bounds, displayedComponents: .date).datePickerStyle(.compact)
    }

    private func pick(_ preset: AnalyticsPreset) {
        if preset == .custom {
            holder.showCustom(first: range.from, second: range.to)
        } else {
            holder.show(preset: preset)
        }
    }
}

extension AnalyticsPreset {
    var label: String {
        switch self {
        case .week: a11("a11.preset.week")
        case .month: a11("a11.preset.month")
        case .year: a11("a11.preset.year")
        case .custom: a11("a11.preset.custom")
        }
    }
}
