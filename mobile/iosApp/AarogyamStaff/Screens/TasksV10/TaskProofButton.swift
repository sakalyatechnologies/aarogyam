import PhotosUI
import SakalyaUI
import SwiftUI

/// A small camera button on an open task: takes a photo (the photo library where the device has no camera)
/// and hands back the shrunken JPEG. The photo never reaches disk.
struct TaskProofButton: View {
    let onPhoto: (Data) -> Void
    @Environment(\.skTheme) private var theme
    @State private var camera = false
    @State private var library: PhotosPickerItem?

    var body: some View {
        let label = TasksV10.t("tasks10.proof")
        Group {
            if CameraPicker.isAvailable {
                Button { camera = true } label: { icon }
            } else {
                PhotosPicker(selection: $library, matching: .images) { icon }
            }
        }
        .accessibilityLabel(label)
        .onChange(of: library) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self), let jpeg = PhotoPrep.jpeg(from: data) { onPhoto(jpeg) }
                library = nil
            }
        }
        .sheet(isPresented: $camera) {
            CameraPicker { data in if let jpeg = PhotoPrep.jpeg(from: data) { onPhoto(jpeg) } }.ignoresSafeArea()
        }
    }

    private var icon: some View {
        Image(systemName: "camera")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(theme.roles.onPrimaryContainer.color)
            .frame(minWidth: SkSpacing.minTouchTarget, minHeight: SkSpacing.minTouchTarget)
            .background(theme.roles.primaryContainer.color, in: Circle())
    }
}
