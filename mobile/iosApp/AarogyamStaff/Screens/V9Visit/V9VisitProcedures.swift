import AarogyamShared
import SakalyaUI
import SwiftUI

/// Treatment done: tooth chips, procedure chips and the lines added so far. A done procedure
/// cannot be changed once it is on the server, so lines stay here (and can be removed) until the
/// visit closes, when each is logged through the visit's procedure call.
struct V9Procedures: View {
    let chart: ChartStateHolder
    let state: ChartState
    @Binding var staged: [StagedProcedure]
    let locked: Bool
    @State private var tooth: Int?
    @State private var needTooth = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        V7Card {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                HStack(alignment: .firstTextBaseline) {
                    Text("v9v.proc.title", tableName: "VisitV9").v7Text(16, .heavy).foregroundStyle(r.onSurface.color)
                    Spacer(minLength: 8)
                    Text(staged.isEmpty ? V9("v9v.proc.sub") : V9f("v9v.proc.count", staged.count))
                        .v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
                }
                switch onEnum(of: state) {
                case .loading:
                    SkLoadingIndicator(V9("v9v.proc.loading"))
                case .notAllowed:
                    Text("v9v.proc.not_allowed", tableName: "VisitV9").v7Text(13).foregroundStyle(r.onSurfaceVariant.color)
                case .failed(let failed):
                    Text(failed.error.message).v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                    SkPillButton(V9("v9v.retry"), variant: .tonal) { chart.refresh() }
                case .loaded(let loaded):
                    picker(loaded)
                }
                if !staged.isEmpty { lines }
            }
            .animation(.smooth(duration: 0.25), value: staged.map(\.id))
        }
    }

    @ViewBuilder private func picker(_ chart: ChartStateLoaded) -> some View {
        let r = theme.roles
        let teeth = teethToOffer(chart)
        let all = (chart.upper + chart.lower).map { Int($0.number) }
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: SkSpacing.sm) {
                ForEach(teeth, id: \.self) { number in
                    SkChoiceChip(String(number), selected: tooth == number) { tooth = number; needTooth = false }
                        .accessibilityLabel(V9f("v9v.proc.tooth.a11y", number))
                }
                Menu {
                    ForEach(all, id: \.self) { number in Button(String(number)) { tooth = number; needTooth = false } }
                } label: {
                    Text("v9v.proc.other", tableName: "VisitV9").v7Text(15).foregroundStyle(r.onSurfaceVariant.color)
                        .padding(.horizontal, 14).frame(minHeight: 44).background(r.surface3.color, in: Capsule())
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.horizontal, -16)
        if needTooth {
            Text("v9v.proc.pick_tooth", tableName: "VisitV9").v7Text(12.5, .semibold).foregroundStyle(r.error.color)
        }
        let procedures = ChartModelKt.matchTerms(terms: chart.terms, kind: .procedure, text: "")
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: SkSpacing.sm) {
                ForEach(procedures, id: \.id) { term in
                    Button { add(term) } label: {
                        HStack(spacing: 6) {
                            V7Icon(name: "plus", size: 14, tint: r.onSurface.color)
                            Text(term.label).v7Text(14).lineLimit(1)
                        }
                        .foregroundStyle(r.onSurface.color)
                        .padding(.horizontal, 12).frame(minHeight: 44).background(r.surface3.color, in: Capsule())
                    }
                    .buttonStyle(.skPressable)
                    .disabled(locked)
                    .accessibilityLabel(V9f("v9v.proc.add.a11y", term.label))
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.horizontal, -16)
    }

    private var lines: some View {
        let r = theme.roles
        return VStack(spacing: 6) {
            ForEach(staged) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.term.label).v7Text(14.5, .bold).foregroundStyle(r.onSurface.color)
                        Text(V9f("v9v.proc.tooth", item.tooth)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                    }
                    Spacer(minLength: 8)
                    if !locked {
                        Button { staged.removeAll { $0.id == item.id } } label: {
                            V7Icon(name: "plus", size: 18, tint: r.onSurface.color).rotationEffect(.degrees(45))
                                .frame(width: 44, height: 44).background(r.surface3.color, in: Circle())
                        }
                        .accessibilityLabel(V9f("v9v.proc.remove.a11y", item.term.label))
                    }
                }
                .padding(.vertical, 6).padding(.horizontal, 12)
                .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .transition(.opacity.combined(with: .move(edge: .leading)))
            }
            Text("v9v.proc.saved_on_close", tableName: "VisitV9").v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Teeth with something recorded, plus the ones already picked here, in FDI order.
    private func teethToOffer(_ chart: ChartStateLoaded) -> [Int] {
        let withFindings = (chart.upper + chart.lower).filter { !$0.findings.isEmpty }.map { Int($0.number) }
        return Array(Set(withFindings + staged.map(\.tooth) + (tooth.map { [$0] } ?? []))).sorted()
    }

    private func add(_ term: TermView) {
        guard let tooth else { needTooth = true; return }
        staged.append(StagedProcedure(tooth: tooth, term: term))
    }
}
