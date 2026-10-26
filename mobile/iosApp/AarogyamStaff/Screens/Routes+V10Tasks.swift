import AarogyamShared
import SwiftUI

/// v10 entry points for the My tasks (the staff task list). The shell calls `hook` once, so a later
/// screen changes this file only. The hook draws nothing; `screen` and `badge` are for the shell to mount.
enum RoutesV10Tasks {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        RoutesV10TasksPlaceholder()
    }

    /// The My tasks screen.
    static func screen(graph: AppGraph, clinic: ClinicContext) -> some View {
        TasksV10Screen(graph: graph, clinic: clinic)
    }

    /// The open-task count for a tab badge; nil when there is none or the role has no tasks.
    static func badge(graph: AppGraph, clinic: ClinicContext) -> some View {
        TasksV10Badge(graph: graph, clinic: clinic)
    }
}

/// A small count pill that follows the holder; hidden at zero.
private struct TasksV10Badge: View {
    let graph: AppGraph
    let clinic: ClinicContext
    @State private var model: TasksV10Model?

    var body: some View {
        ZStack {
            if let model { BadgeText(model: model) }
        }
        .onAppear { if model == nil { model = TasksV10Model(graph: graph, clinic: clinic) } }
        .onDisappear { model?.close(); model = nil }
    }
}

private struct BadgeText: View {
    @ObservedObject var model: TasksV10Model
    var body: some View {
        let n = Int(model.state.openCount)
        if n > 0 { Text("\(n)").accessibilityLabel(TasksV10.openLabel(n)) }
    }
}

/// Takes no space and is hidden from VoiceOver; replaced when the screen is built.
struct RoutesV10TasksPlaceholder: View {
    var body: some View {
        Color.clear.frame(width: 0, height: 0).accessibilityHidden(true)
    }
}
