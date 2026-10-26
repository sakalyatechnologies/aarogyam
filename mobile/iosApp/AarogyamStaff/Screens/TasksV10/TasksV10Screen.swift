import AarogyamShared
import SakalyaUI
import SwiftUI
import UIKit

/// Owns the My tasks holder and the scope it lives in; the scope closes when the screen goes.
@MainActor
final class TasksV10Model: ObservableObject {
    @Published private(set) var state: MyTasksState
    @Published private(set) var stock: [StockRow] = []
    @Published private(set) var bursts = 0
    let holder: any MyTasksHolder
    private let graph: AppGraph
    private let clinic: ClinicContext
    private var scope: ScreenScope?
    private var jobs: [Task<Void, Never>] = []

    init(graph: AppGraph, clinic: ClinicContext) {
        self.graph = graph
        self.clinic = clinic
        let scope = ScreenScope()
        self.scope = scope
        let holder = graph.myTasks(clinic: clinic, screen: scope)
        self.holder = holder
        let flow = holder.state
        state = flow.value
        jobs.append(Task { [weak self] in for await next in flow { self?.state = next } })
        let events = holder.celebrate
        jobs.append(Task { [weak self] in for await _ in events { self?.bursts += 1 } })
    }

    /// Reads the low-stock list once, for the usage sheet.
    func loadStock() {
        guard stock.isEmpty, let scope, jobs.count < 3 else { return }
        let holder = graph.stock(clinic: clinic, screen: scope)
        jobs.append(Task { [weak self] in
            for await next in holder.state {
                if case .loaded(let loaded) = onEnum(of: next) { self?.stock = loaded.items.compactMap { $0 as? StockRow } }
            }
        })
    }

    func close() {
        jobs.forEach { $0.cancel() }
        jobs = []
        scope?.close()
        scope = nil
    }
}

/// My tasks: the open tasks with a Done button each, and confetti when one finishes.
struct TasksV10Screen: View {
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var model: TasksV10Model?

    var body: some View {
        ZStack {
            if let model { TasksV10Content(model: model) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { if model == nil { model = TasksV10Model(graph: graph, clinic: clinic) } }
        .onDisappear { model?.close(); model = nil }
    }
}

private struct TasksV10Content: View {
    @ObservedObject var model: TasksV10Model
    @Environment(\.skTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var noteFor: TaskRow?
    @State private var usageFor: TaskRow?
    @State private var burstId = 0

    var body: some View {
        let r = theme.roles
        let s = model.state
        ZStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Text("tasks10.title", tableName: "TasksV10").skTextStyle(SkTypeScale.title).accessibilityAddTraits(.isHeader)
                        Spacer()
                        if !s.notAllowed, !s.loading {
                            Text(TasksV10.openLabel(Int(s.openCount))).v7Text(13, .semibold).foregroundStyle(r.onSurfaceVariant.color)
                        }
                    }
                    if s.notAllowed {
                        Text("tasks10.not_allowed", tableName: "TasksV10").skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
                    } else if s.loading {
                        SkLoadingIndicator(TasksV10.t("tasks10.loading")).frame(maxWidth: .infinity)
                    } else if s.rows.isEmpty {
                        if let e = s.loadError {
                            Text(e.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color)
                            SkPillButton(TasksV10.t("tasks10.retry"), variant: .tonal) { model.holder.refresh() }
                        } else {
                            SkEmptyState(TasksV10.emptyLabel(), message: "")
                        }
                    } else {
                        ForEach(s.rows, id: \.id) { row in
                            TaskRowView(row: row, onDone: { start(row) }, onRetry: { start(row) })
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { model.holder.refresh() }
            if burstId > 0 && !reduceMotion { ConfettiBurst().id(burstId).allowsHitTesting(false).accessibilityHidden(true) }
        }
        .onChange(of: model.bursts) { _, _ in
            burstId += 1
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
        .sheet(item: $noteFor) { row in NoteSheet(row: row) { model.holder.complete(id: row.id, note: $0, usage: nil) } }
        .sheet(item: $usageFor) { row in UsageSheet(row: row, model: model) { model.holder.complete(id: row.id, note: $0, usage: $1) } }
    }

    private func start(_ row: TaskRow) {
        if row.error != nil, row.action == .none { model.holder.complete(id: row.id, note: nil, usage: nil); return }
        switch row.action {
        case .recordUsage: model.loadStock(); usageFor = row
        case .confirmPhotos: model.holder.complete(id: row.id, note: nil, usage: nil)
        default: noteFor = row
        }
    }
}

extension TaskRow: @retroactive Identifiable {}

private struct TaskRowView: View {
    let row: TaskRow
    let onDone: () -> Void
    let onRetry: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                Text(row.title).skTextStyle(SkTypeScale.bodyStrong).foregroundStyle(r.onSurface.color).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if row.overdue { V7Pill(text: TasksV10.overdueLabel(), kind: .error) }
            }
            if let due = TasksV10.dueLabel(row.dueAt) { Text(due).v7Text(12.5).foregroundStyle(row.overdue ? r.error.color : r.onSurfaceVariant.color) }
            if row.action == .confirmPhotos, let n = row.patientsWithoutPhotos?.intValue {
                Text(TasksV10.photosLabel(n)).v7Text(12.5, .semibold).foregroundStyle(r.onSurface.color)
            }
            if row.pending {
                ProgressView().accessibilityLabel(TasksV10.t("tasks10.in_progress"))
            } else {
                if row.error != nil {
                    Text("tasks10.error", tableName: "TasksV10").v7Text(12.5, .semibold).foregroundStyle(r.error.color)
                }
                SkPillButton(row.error != nil ? TasksV10.t("tasks10.retry") : TasksV10.t("tasks10.done"), variant: .fill, wide: true) {
                    row.error != nil ? onRetry() : onDone()
                }
            }
        }
        .padding(14)
        .background(r.surface2.color, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }
}

private struct NoteSheet: View {
    let row: TaskRow
    let done: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""

    var body: some View {
        SkSheetScaffold(row.title) {
            VStack(alignment: .leading, spacing: 12) {
                SkField(TasksV10.t("tasks10.note"), text: $note)
                SkPillButton(TasksV10.t("tasks10.done"), variant: .fill, wide: true) {
                    done(note.isEmpty ? nil : String(note.prefix(300)))
                    dismiss()
                }
            }
        }
        .skSheet()
    }
}

private struct UsageSheet: View {
    let row: TaskRow
    @ObservedObject var model: TasksV10Model
    let done: (String?, [UsageLine]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var quantities: [String: String] = [:]

    var body: some View {
        SkSheetScaffold(TasksV10.t("tasks10.usage.title")) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(model.stock, id: \.id) { item in
                    HStack {
                        Text("\(item.name) (\(item.unit))").skTextStyle(SkTypeScale.body).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 8)
                        TextField(TasksV10.t("tasks10.usage.qty"), text: Binding(get: { quantities[item.id] ?? "" }, set: { quantities[item.id] = $0 }))
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing).frame(width: 90)
                            .accessibilityLabel("\(TasksV10.t("tasks10.usage.qty")) \(item.name)")
                    }
                }
                SkField(TasksV10.t("tasks10.note"), text: $note)
                if !lines.isEmpty {
                    SkPillButton(TasksV10.t("tasks10.usage.save"), variant: .fill, wide: true) { finish(lines) }
                }
                SkPillButton(TasksV10.t("tasks10.nothing_used"), variant: .tonal, wide: true) { finish([]) }
            }
        }
        .skSheet()
    }

    private var lines: [UsageLine] {
        model.stock.compactMap { item in
            TasksV10.quantity(quantities[item.id] ?? "").map { UsageLine(itemId: item.id, quantity: $0) }
        }
    }

    private func finish(_ used: [UsageLine]) {
        done(note.isEmpty ? nil : String(note.prefix(300)), used)
        dismiss()
    }
}

/// A short burst of coloured pieces, about 1.5 seconds; the caller skips it under Reduce Motion.
private struct ConfettiBurst: View {
    @State private var go = false

    var body: some View {
        GeometryReader { g in
            ZStack {
                ForEach(0..<28, id: \.self) { i in piece(i) }
            }
            .position(x: g.size.width / 2, y: g.size.height * 0.2)
        }
        .onAppear { withAnimation(.easeOut(duration: 1.5)) { go = true } }
    }

    private func piece(_ i: Int) -> some View {
        let dx: Double = Double((i * 37) % 200 - 100) * 1.6
        let dy: Double = Double((i * 53) % 260 + 80)
        let hue: Double = Double(i % 7) / 7.0
        let spin: Double = Double(i * 40) + 360
        return RoundedRectangle(cornerRadius: 2)
            .fill(Color(hue: hue, saturation: 0.7, brightness: 0.95))
            .frame(width: 8, height: 12)
            .rotationEffect(.degrees(go ? spin : 0))
            .offset(x: go ? dx : 0, y: go ? dy : -20)
            .opacity(go ? 0 : 1)
    }
}
