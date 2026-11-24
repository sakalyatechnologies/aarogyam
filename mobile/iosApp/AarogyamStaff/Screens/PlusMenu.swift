import AarogyamShared
import SakalyaUI
import SwiftUI

/// The bar's "+" (founder, 23 Nov): it opens the one search, which finds the patient or starts a new one, and from
/// there checks in, books or just saves. No menu of separate flows.
struct PlusMenu: View {
    @Binding var walkIn: Bool

    var body: some View {
        Button { walkIn = true } label: { Label { Text("v7.action.walk_in") } icon: { V7Icon.image("plus") } }
    }
}
