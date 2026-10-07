import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// The Files tab of Patient 360: the gallery grouped by label, and (with `clinical.write`) take or pick a photo.
struct FilesTab: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String

    var body: some View {
        ScreenHost(make: { graph.files(clinic: clinic, patientId: patientId, screen: $0) }, state: { $0.state }) { holder, state in
            FilesGallery(holder: holder, state: state)
        }
    }
}

private struct FilesGallery: View {
    let holder: FilesStateHolder
    let state: FilesState
    @Environment(\.skTheme) private var theme
    @State private var chosen: PhotosPickerItem?
    @State private var photo: Data?
    @State private var showCamera = false
    @State private var unreadable = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) { content }
                .padding(.horizontal, SkSpacing.l)
                .padding(.bottom, SkSpacing.xxl)
        }
        .refreshable { holder.refresh() }
        .sheet(isPresented: Binding(get: { photo != nil }, set: { if !$0 { photo = nil } })) {
            if let photo {
                LabelSheet(photo: photo) { label, tooth, jpeg in
                    self.photo = nil
                    holder.upload(jpeg: jpeg.kotlinBytes, label: label, tooth: tooth.map { KotlinInt(int: Int32($0)) })
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { photo = $0 }.ignoresSafeArea()
        }
        .onChange(of: chosen) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { photo = data } else { unreadable = true }
                chosen = nil
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch onEnum(of: state) {
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
        case .notAllowed:
            SkEmptyState(String(localized: "patient.tab.files"), message: String(localized: "files.not_allowed"))
        case .failed(let failed):
            SkEmptyState(
                String(localized: "patient.tab.files"),
                message: failed.error.message,
                actionTitle: String(localized: "try_again"),
                action: holder.refresh
            )
        case .loaded(let loaded):
            if loaded.canUpload { addPhoto(uploading: loaded.uploading) }
            if let error = loaded.error { problem(error.message) }
            if let upload = loaded.problem { problem(upload.message) }
            if unreadable { problem(String(localized: "files.problem.read")) }
            if loaded.groups.isEmpty {
                SkEmptyState(String(localized: "files.empty.title"), message: String(localized: "files.empty.message"))
            }
            ForEach(loaded.groups, id: \.label) { group in groupCard(group) }
        }
    }

    private func problem(_ text: String) -> some View {
        Text(text).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.dangerText.color)
    }

    private func addPhoto(uploading: Bool) -> some View {
        HStack(spacing: SkSpacing.sm) {
            if CameraPicker.isAvailable {
                SkButton(uploading ? String(localized: "files.uploading") : String(localized: "files.take")) { showCamera = true }
                    .disabled(uploading)
            }
            PhotosPicker(selection: $chosen, matching: .images) {
                Text(String(localized: "files.choose")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(uploading)
        }
    }

    private func groupCard(_ group: LabelGroup) -> some View {
        SkCard {
            VStack(alignment: .leading, spacing: SkSpacing.sm) {
                Text(group.label ?? String(localized: "files.unlabelled"))
                    .skTextStyle(SkTypeScale.headline).foregroundStyle(theme.palette.text.color)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: SkSpacing.sm), count: 3), spacing: SkSpacing.sm) {
                    ForEach(group.files, id: \.id) { Thumb(holder: holder, file: $0) }
                }
            }
        }
    }
}

private struct Thumb: View {
    let holder: FilesStateHolder
    let file: FileView
    @Environment(\.skTheme) private var theme
    @State private var image: UIImage?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ZStack {
                Rectangle().fill(theme.palette.background.color)
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Text(String(localized: "files.not_image")).skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
                }
            }
            .frame(height: 96)
            .clipped()
            if let tooth = file.tooth {
                Text(String(format: String(localized: "files.tooth"), tooth.intValue))
                    .skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
            }
        }
        .task(id: file.id) {
            guard file.isImage, let bytes = try? await holder.preview(id: file.id) else { return }
            image = UIImage(data: bytes.data)
        }
    }
}

/// Asks for the label and tooth, shrinks the photo on the phone, then hands the JPEG over.
private struct LabelSheet: View {
    let photo: Data
    let onSend: (String?, Int?, Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var preset: String?
    @State private var custom = ""
    @State private var toothText = ""
    @State private var unreadable = false

    var body: some View {
        NavigationStack {
            Form {
                Section(String(localized: "files.label.title")) {
                    ForEach(PhotoRulesKt.PRESET_LABELS, id: \.self) { label in
                        Button {
                            preset = preset == label ? nil : label
                            custom = ""
                        } label: {
                            HStack {
                                Text(label)
                                Spacer()
                                if preset == label { Image(systemName: "checkmark") }
                            }
                        }
                    }
                    TextField(String(localized: "files.label.custom"), text: $custom)
                        .onChange(of: custom) { _, text in if !text.isEmpty { preset = nil } }
                }
                Section {
                    TextField(String(localized: "files.tooth.field"), text: $toothText).keyboardType(.numberPad)
                }
                if unreadable { Text(String(localized: "files.problem.read")) }
            }
            .navigationTitle(String(localized: "files.label.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(String(localized: "files.cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "files.send")) {
                        guard let jpeg = PhotoPrep.jpeg(from: photo) else { unreadable = true; return }
                        onSend(preset ?? (custom.isEmpty ? nil : custom), Int(toothText), jpeg)
                    }
                }
            }
        }
    }
}
