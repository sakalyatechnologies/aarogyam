import AarogyamShared
import SwiftUI

/// The screens iOS worker A built, as one entry point each, so the shared shell (MainTabs,
/// RootView) only needs a line to show them.
enum RoutesA {
    /// v7 Today: its state holder and the notifications holder behind the bell.
    @ViewBuilder static func today(
        graph: AppGraph, clinic: ClinicContext,
        onOpenPatient: @escaping (String) -> Void, onOpenSchedule: @escaping () -> Void, onAddExpense: (() -> Void)?
    ) -> some View {
        ScreenHost(make: { graph.today(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            ScreenHost(make: { graph.notifications(clinic: clinic, screen: $0) }, state: { $0.state }) { notifications, list in
                TodayV7Screen(
                    graph: graph, clinic: clinic, holder: holder, state: state, notifications: notifications, notificationsState: list,
                    onOpenPatient: onOpenPatient, onOpenSchedule: onOpenSchedule, onAddExpense: onAddExpense
                )
            }
        }
    }
}
