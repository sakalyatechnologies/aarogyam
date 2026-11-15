import AarogyamShared
import Foundation

extension AppModel {
    /// The APNs token (hex) from the delegate; sent to the server once signed in.
    func receive(token hex: String) {
        pushState.token = hex
        flushPush()
    }

    /// A tapped push: waits until the person is signed in and the graph is ready.
    func receive(tap: PushTap) {
        pushState.tap = tap
        flushPush()
    }

    func flushPush() {
        guard case .ready(let graph) = phase else { return }
        graph.push.setLocale(tag: PushLogic.localeTag())
        if let token = pushState.token { graph.push.setToken(hex: token) }
        guard let tap = pushState.tap, let session, case .signedIn = onEnum(of: session) else { return }
        pushState.tap = nil
        Task { await openPush(tap, graph: graph) }
    }

    /// Switches clinic when the push is for another one, marks it read and asks MainTabs for its screen.
    private func openPush(_ tap: PushTap, graph: AppGraph) async {
        if let org = tap.orgId, clinic?.session.clinic.id != org {
            guard let result = try? await graph.directory.clinics(refresh: false),
                  case .success(let ok) = onEnum(of: result),
                  let list = ok.value as? [MyClinic],
                  let target = list.first(where: { $0.orgId == org }),
                  (try? await graph.directory.open(clinic: target)) != nil else { return }
        }
        guard let open = graph.directory.current.value else { return }
        if let id = tap.notificationId { _ = try? await open.api.markNotificationRead(id: id) }
        pushTarget = PushTarget(destination: PushLogic.destination(href: tap.href))
    }
}
