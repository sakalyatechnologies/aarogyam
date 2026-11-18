import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// Under a given consent: "View signed form" when one is linked, else "Add signed form" (the camera,
/// or the photo library where the device has none) for a role that may write.
struct V9SignedFormLink: View {
    let consent: ConsentView
    let forms: ConsentFormsHolder
    let state: ConsentFormsState
    let canAdd: Bool
    @State private var camera = false
    @State private var library: PhotosPickerItem?
    @Environment(\.skTheme) private var theme

    var body: some View {
        Group {
            if let formId = consent.signedFormId {
                link(p9("p9.consent.form_view")) { forms.open(attachmentId: formId) }
            } else if state.attaching == consent.id {
                V7Muted(p9("p9.consent.form_adding"))
            } else if canAdd {
                if CameraPicker.isAvailable {
                    link(p9("p9.consent.form_add")) { camera = true }
                } else {
                    PhotosPicker(selection: $library, matching: .images) { label(p9("p9.consent.form_add")) }
                }
            }
        }
        .onChange(of: library) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self), let jpeg = PhotoPrep.jpeg(from: data) { attach(jpeg) }
                library = nil
            }
        }
        .sheet(isPresented: $camera) {
            CameraPicker { data in if let jpeg = PhotoPrep.jpeg(from: data) { attach(jpeg) } }.ignoresSafeArea()
        }
    }

    private func attach(_ jpeg: Data) { forms.attach(consentId: consent.id, jpeg: jpeg.kotlinBytes) }

    private func link(_ text: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { label(text) }.buttonStyle(.plain)
    }

    private func label(_ text: String) -> some View {
        Text(text).v7Text(12.5, .bold).foregroundStyle(theme.roles.primary.color).frame(minHeight: 36)
    }
}
