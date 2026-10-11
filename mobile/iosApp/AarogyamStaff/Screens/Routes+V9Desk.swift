import AarogyamShared
import SakalyaUI
import SwiftUI

/// The v9 front desk's entry points, so the shell needs only a line each.
enum RoutesDesk {
    /// The Walk-in sheet: lookup by mobile number, then the walk-in form.
    static func sheet(graph: AppGraph, clinic: ClinicContext) -> some View {
        DeskSheet(graph: graph, clinic: clinic)
    }

    /// A row under Schedule's segmented control that opens the waiting-room board.
    static func boardEntry(graph: AppGraph, clinic: ClinicContext, visible: Bool, onOpenPatient: @escaping (String) -> Void) -> some View {
        DeskBoardEntry(graph: graph, clinic: clinic, visible: visible, onOpenPatient: onOpenPatient)
    }
}

struct DeskBoardEntry: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let visible: Bool
    let onOpenPatient: (String) -> Void
    @State private var open = DeskLaunch.opensBoard
    @State private var paying: DeskPayTarget?
    @Environment(\.skTheme) private var theme

    var body: some View {
        Group {
            if visible {
                Button { open = true } label: {
                    HStack(spacing: 8) {
                        V7Icon(name: "users", size: 18, tint: theme.roles.primary.color)
                        Text(dv("d9.board.open")).v7Text(14, .bold)
                        Spacer(minLength: 0)
                        V7Icon(name: "chev", size: 16, tint: theme.roles.onSurfaceVariant.color)
                    }
                    .foregroundStyle(theme.roles.onSurface.color)
                    .padding(.horizontal, 14).frame(minHeight: SkSpacing.minTouchTarget)
                    .background(theme.roles.card.color, in: Capsule())
                    .padding(.horizontal, SkSpacing.l).padding(.bottom, SkSpacing.s)
                }
                .buttonStyle(.skPressable)
            }
        }
        .sheet(isPresented: $open) {
            NavigationStack {
                ScreenHost(make: { graph.deskBoard(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
                    DeskBoardScreen(holder: holder, state: state, clinic: clinic, onOpenPatient: { id in
                        open = false
                        onOpenPatient(id)
                    }, onCollect: { paying = $0 })
                }
                .navigationTitle(dv("d9.board.title"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { Button(dv("d9.done")) { open = false } }
                }
                .sheet(item: $paying) { DeskPaymentSheet(graph: graph, clinic: clinic, target: $0) }
            }
        }
    }
}

#if DEBUG && AARO_ENV_Local
import UIKit

/// Screenshot runs (Local debug builds only):
/// - `SIMCTL_CHILD_AAROGYAM_DEV_SHEET=walkin` opens the desk sheet; `_DEV_DESK_PHONE=<digits>` types the number.
/// - `_DEV_DESK=new` or `family` starts on the walk-in form with `_DEV_DESK_PHONE` filled in.
/// - `_DEV_DESK=board` (with `_DEV_TAB=schedule`) opens the waiting-room board.
/// - `_DEV_DESK_PAY=<patient id>` opens Collect payment; `_DEV_DESK_PROOF=1` attaches a sample receipt photo.
enum DeskLaunch {
    private static var env: [String: String] { ProcessInfo.processInfo.environment }
    static var firstPhone: String { env["AAROGYAM_DEV_DESK_PHONE"] ?? "" }
    static var opensBoard: Bool { env["AAROGYAM_DEV_DESK"] == "board" }
    static var firstPayTarget: DeskPayTarget? {
        env["AAROGYAM_DEV_DESK_PAY"].map { DeskPayTarget(patientId: $0, name: env["AAROGYAM_DEV_DESK_NAME"] ?? "Patient") }
    }

    static var firstMode: DeskSheet.Mode {
        switch env["AAROGYAM_DEV_DESK"] {
        case "new": .form(phone: firstPhone, family: nil)
        case "family": .form(phone: firstPhone, family: [])
        default: .lookup
        }
    }

    /// A drawn receipt stands in for a camera photo in the simulator.
    static func attachSampleProof(_ set: @escaping (Data) -> Void) async {
        guard env["AAROGYAM_DEV_DESK_PROOF"] == "1" else { return }
        let size = CGSize(width: 600, height: 800)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            UIColor(red: 0.96, green: 0.94, blue: 0.88, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let lines = ["UPI PAYMENT", "Paid", "Rs 1,200.00", "Ref 0000 0000 0000", "Synthetic sample"]
            for (index, line) in lines.enumerated() {
                (line as NSString).draw(at: CGPoint(x: 40, y: 80 + index * 110), withAttributes: [.font: UIFont.boldSystemFont(ofSize: index == 2 ? 56 : 40), .foregroundColor: UIColor.darkGray])
            }
        }
        if let data = image.jpegData(compressionQuality: 0.9) { set(data) }
    }
}
#else
/// Release and Demo builds have no launch hooks.
enum DeskLaunch {
    static var firstPhone: String { "" }
    static var opensBoard: Bool { false }
    static var firstPayTarget: DeskPayTarget? { nil }
    static var firstMode: DeskSheet.Mode { .lookup }
    static func attachSampleProof(_ set: @escaping (Data) -> Void) async {}
}
#endif
