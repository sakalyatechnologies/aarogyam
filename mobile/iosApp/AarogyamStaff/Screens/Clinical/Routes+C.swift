import AarogyamShared
import SakalyaUI
import SwiftUI

/// This worker's screens, hooked into the shared shell from one place.
enum ClinicalRoutes {
    /// The More destination for `route`, falling back to the Preview page for what has no screen.
    @ViewBuilder static func destination(_ route: MoreRoute, graph: AppGraph, clinic: ClinicContext, path: Binding<[MoreRoute]>) -> some View {
        switch route {
        case .analytics:
            ScreenHost(make: { graph.analytics(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                AnalyticsScreen(graph: graph, clinic: clinic, holder: holder, state: state)
            }
        case .expenses:
            expensesPage(graph: graph, clinic: clinic, showsAdd: true)
        case .messages:
            ScreenHost(make: { graph.inbox(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                InboxPage(holder: holder, state: state, canChat: clinic.permissions.contains("chat.use"), path: path)
            }
        case .team:
            ScreenHost(make: { graph.team(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                TeamPage(holder: holder, state: state, canChat: clinic.permissions.contains("chat.use"), path: path)
            }
        case .chats:
            ScreenHost(make: { graph.chatList(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                ChatListPage(holder: holder, state: state, path: path)
            }
        case .thread(let id, let title):
            ScreenHost(make: { graph.chatThread(clinic: clinic, conversationId: id, screen: $0) }, state: { $0.state }) { holder, state in
                ChatThreadPage(holder: holder, state: state)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        case .help:
            HelpPage()
        case .stock, .labs, .rxSets:
            PreviewPage(title: route.title)
        }
    }

    /// The month's expenses over their state holder.
    static func expensesPage(graph: AppGraph, clinic: ClinicContext, showsAdd: Bool) -> some View {
        ScreenHost(make: { graph.expenses(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            ExpensesScreen(holder: holder, state: state, showsAdd: showsAdd)
        }
    }
}

extension View {
    /// Pushes the Visit screen for a `VisitRoute`.
    func visitDestination(graph: AppGraph, clinic: ClinicContext) -> some View {
        navigationDestination(for: VisitRoute.self) { VisitScreen(graph: graph, clinic: clinic, route: $0) }
    }
}
