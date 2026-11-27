import AarogyamShared
import SakalyaUI
import SwiftUI

/// The optional postal address of a new patient, PIN first. A full six-digit PIN fills city, district and state,
/// which then show as text with a "Change" link that turns them back into fields. Every field forwards to the
/// form's state holder.
struct AddressFields: View {
    let address: AddressForm
    let onChange: (AddressField, String) -> Void
    @State private var changing = false
    @Environment(\.skTheme) private var theme

    private var filled: Bool {
        address.pincode.count == 6 && !address.city.isEmpty && !address.state.isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SkField(
                String(localized: "address.pincode"),
                text: Binding(get: { address.pincode }, set: { onChange(.pincode, $0) }),
                error: address.pincodeIncomplete ? String(localized: "address.pincode.hint") : nil,
                contentType: .postalCode,
                keyboard: .numberPad
            )
            if filled && !changing {
                HStack {
                    Text([address.city, address.district, address.state].filter { !$0.isEmpty }.joined(separator: ", "))
                        .font(.callout.weight(.semibold)).foregroundStyle(theme.roles.onSurface.color)
                    Spacer()
                    SkPillButton(String(localized: "address.change"), variant: .ghost) { changing = true }
                }
            } else {
                field("address.city", .city, address.city, type: .addressCity)
                field("address.district", .district, address.district)
                field("address.state", .state, address.state, type: .addressState)
            }
            field("address.line1", .line1, address.line1, type: .streetAddressLine1)
            field("address.locality", .locality, address.locality)
        }
        .onChange(of: address.pincode) { _, _ in changing = false }
    }

    private func field(_ label: String.LocalizationValue, _ part: AddressField, _ value: String, type: UITextContentType? = nil) -> some View {
        SkField(String(localized: label), text: Binding(get: { value }, set: { onChange(part, $0) }), contentType: type)
    }
}
