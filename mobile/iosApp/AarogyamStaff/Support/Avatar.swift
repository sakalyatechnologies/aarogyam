import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// The person's avatar: one of the illustrated dentists, or a photo kept on this phone only
/// (server storage is BK-10). The choice lives in the shared preferences.
enum AvatarChoice {
    static let photoKey = "photo"
    static let defaultArt = "d1"

    /// The chosen illustration (the default when a photo or nothing is chosen).
    @MainActor static func current(_ graph: AppGraph) -> ArtPiece {
        let id = graph.preferences.get(key: .avatarChoice) ?? defaultArt
        return AvatarArt.shared.all[id] ?? AvatarArt.shared.all[defaultArt] ?? AvatarArt.shared.all.values.first!
    }

    @MainActor static func photo(_ graph: AppGraph) -> UIImage? {
        guard graph.preferences.get(key: .avatarChoice) == photoKey else { return nil }
        return (try? Data(contentsOf: photoURL)).flatMap(UIImage.init(data:))
    }

    static var photoURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("avatar.jpg")
    }

    /// Keeps a square, small copy of [data] as the avatar photo.
    @MainActor static func savePhoto(_ data: Data, graph: AppGraph) {
        guard let image = UIImage(data: data) else { return }
        let side = min(image.size.width, image.size.height)
        let crop = CGRect(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2, width: side, height: side)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 256, height: 256))
        let small = renderer.image { _ in
            image.draw(in: CGRect(x: -crop.minX * 256 / side, y: -crop.minY * 256 / side, width: image.size.width * 256 / side, height: image.size.height * 256 / side))
        }
        guard let jpeg = small.jpegData(compressionQuality: 0.85) else { return }
        try? jpeg.write(to: photoURL, options: [.atomic, .completeFileProtection])
        graph.preferences.set(key: .avatarChoice, value: photoKey)
    }
}

/// The person's avatar drawn: their photo, or the chosen illustration.
struct MyAvatar: View {
    let graph: AppGraph
    var revision = 0

    var body: some View {
        if let photo = AvatarChoice.photo(graph) {
            Image(uiImage: photo).resizable().scaledToFill()
        } else {
            ArtView(piece: AvatarChoice.current(graph))
        }
    }
}

/// "Your avatar": the eight illustrated dentists, or a photo from the camera or library.
struct AvatarPicker: View {
    let graph: AppGraph
    var onChange: () -> Void = {}
    @State private var chosen: String?
    @State private var camera = false
    @State private var library: PhotosPickerItem?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let ids = AvatarArt.shared.all.keys.sorted()
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.m) {
                Text("v7.avatar.title").skTextStyle(SkTypeScale.headline).foregroundStyle(r.onSurface.color)
                Text("v7.avatar.message").skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(ids, id: \.self) { id in
                        let on = (chosen ?? graph.preferences.get(key: .avatarChoice) ?? AvatarChoice.defaultArt) == id
                        Button {
                            chosen = id
                            graph.preferences.set(key: .avatarChoice, value: id)
                            onChange()
                        } label: {
                            ArtView(piece: AvatarArt.shared.all[id]!)
                                .aspectRatio(1, contentMode: .fit)
                                .background(r.surface2.color)
                                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(on ? r.primary.color : .clear, lineWidth: 2))
                                .shadow(color: on ? r.primary.color.opacity(0.25) : .clear, radius: 3)
                                .scaleEffect(on ? 1.05 : 1)
                                .animation(SkMotionTokens.pressSpring.animation, value: on)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(String(format: String(localized: "v7.avatar.option"), id))
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
                HStack(spacing: 8) {
                    if CameraPicker.isAvailable {
                        SkButton(String(localized: "v7.avatar.camera"), variant: .secondary) { camera = true }
                    }
                    PhotosPicker(selection: $library, matching: .images) {
                        Text("v7.avatar.library").skTextStyle(SkTypeScale.label).frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget)
                    }
                }
            }
            .padding(SkSpacing.l)
        }
        .sheet(isPresented: $camera) {
            CameraPicker { data in
                AvatarChoice.savePhoto(data, graph: graph)
                onChange()
            }
            .ignoresSafeArea()
        }
        .onChange(of: library) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self) {
                    AvatarChoice.savePhoto(data, graph: graph)
                    onChange()
                    dismiss()
                }
            }
        }
    }
}
