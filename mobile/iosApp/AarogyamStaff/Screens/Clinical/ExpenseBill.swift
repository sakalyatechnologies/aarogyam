import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// Bill photo on the Add expense sheet: the camera (the photo library where the device has none) hands
/// back a shrunken JPEG, kept in the draft until the expense is saved. Once attached it removes it.
struct BillPhotoButton: View {
    let attached: Bool
    let onPhoto: (Data) -> Void
    let onRemove: () -> Void
    @State private var camera = false
    @State private var library: PhotosPickerItem?

    var body: some View {
        Group {
            if attached {
                SkPillButton(CL("c.expenses.photo_remove"), variant: .tonal, wide: true, action: onRemove)
            } else if CameraPicker.isAvailable {
                SkPillButton(CL("c.expenses.photo"), variant: .tonal, icon: V7Icon.path("cam"), wide: true) { camera = true }
            } else {
                PhotosPicker(selection: $library, matching: .images) {
                    Label(CL("c.expenses.photo"), systemImage: "camera").frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget)
                }
            }
        }
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
}

/// The expense was saved but its bill photo did not upload: send it again, or go on without it.
struct BillFailedNotice: View {
    let holder: ExpensesStateHolder
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: SkSpacing.sm) {
            Text(CL("c.expenses.bill_failed")).font(.system(size: 12.5, weight: .semibold)).foregroundStyle(theme.roles.error.color)
                .multilineTextAlignment(.center)
            HStack(spacing: SkSpacing.sm) {
                SkPillButton(CL("c.expenses.bill_retry"), wide: true) { holder.retryBill() }
                SkPillButton(CL("c.expenses.bill_skip"), variant: .tonal, wide: true) { holder.dropBill() }
            }
        }
    }
}
