import AarogyamShared
import SwiftUI

/// v10 live updates: the banner for a patient waiting, send in and collect payment. The root calls
/// `hook` once, as an overlay, so a later screen changes this file only.
enum RoutesV10Live {
    @ViewBuilder static func hook(graph: AppGraph, clinic: ClinicContext) -> some View {
        ScreenHost(make: { graph.liveBanners(clinic: clinic, screen: $0) }, state: { $0.state }) { holder, state in
            LiveBannerView(holder: holder, banner: state.banner)
        }
    }
}
