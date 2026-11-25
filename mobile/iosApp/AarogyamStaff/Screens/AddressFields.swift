import AarogyamShared
import SakalyaUI
import SwiftUI

/// The optional postal address of a new patient. A full six-digit PIN fills district and state,
/// which stay editable. Every field forwards to the form's state holder.
struct AddressFields: View {
    let address: AddressForm
    let onChange: (AddressField, String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            field("address.line1", .line1, address.line1, type: .streetAddressLine1)
            field("address.locality", .locality, address.locality)
            field("address.city", .city, address.city, type: .addressCity)
            SkField(
                String(localized: "address.pincode"),
                text: Binding(get: { address.pincode }, set: { onChange(.pincode, $0) }),
                error: address.pincodeIncomplete ? String(localized: "address.pincode.hint") : nil,
                contentType: .postalCode,
                keyboard: .numberPad
            )
            field("address.district", .district, address.district)
            field("address.state", .state, address.state, type: .addressState)
        }
    }

    private func field(_ label: String.LocalizationValue, _ part: AddressField, _ value: String, type: UITextContentType? = nil) -> some View {
        SkField(String(localized: label), text: Binding(get: { value }, set: { onChange(part, $0) }), contentType: type)
    }
}
