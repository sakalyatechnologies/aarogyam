import AarogyamShared
import SwiftUI

/// v10 entry point for Time off, reached from the More tile and from a tapped `time_off_*` push.
enum RoutesV10TimeOff {
    /// The Time off screen over its holder.
    static func screen(graph: AppGraph, clinic: ClinicContext) -> some View {
        ScreenHost(make: { graph.timeOff(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            TimeOffScreen(holder: holder, state: state, clinic: clinic)
        }
    }
}
