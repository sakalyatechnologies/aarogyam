import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// What an added picture is saved as. The English label is what the clinic's files list shows (and what picks the kind).
enum PatientPhotoLabel: CaseIterable, Hashable {
    case xray, photo, oldRx, report

    var apiLabel: String {
        switch self {
        case .xray: "X-ray"
        case .photo: "Photo"
        case .oldRx: "Old Rx"
        case .report: "Report"
        }
    }

    var title: String {
        switch self {
        case .xray: p9("p9.photo.xray")
        case .photo: p9("p9.photo.photo")
        case .oldRx: p9("p9.photo.old_rx")
        case .report: p9("p9.photo.report")
        }
    }
}

/// The patient page's Photo action: pick a label, then the camera or Photos. The picture is saved to the
/// outbox at once (protected storage) and sent from there; `OutboxBadge` shows while it waits.
struct V9PhotoSheet: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let onDone: () -> Void
    @State private var label = PatientPhotoLabel.photo
    @State private var camera = false
    @State private var library: PhotosPickerItem?
    @State private var problem: String?
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 12) {
            SkSheetHeader(p9("p9.photo.title"))
            V7Label(text: p9("p9.photo.label"))
            SkChoiceChips(PatientPhotoLabel.allCases, selected: [label], label: { $0.title }) { label = $0 }
            if let problem { Text(problem).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
            FlowLayout(spacing: 8) {
                if CameraPicker.isAvailable {
                    SkPillButton(p9("p9.photo.camera"), variant: .tonal, icon: V7Icon.path("cam")) { camera = true }
                }
                PhotosPicker(selection: $library, matching: .images) {
                    Text(p9("p9.photo.library")).font(.system(size: 14, weight: .bold)).foregroundStyle(r.onPrimaryContainer.color)
                        .padding(.horizontal, 18).frame(minHeight: SkSpacing.minTouchTarget)
                        .background(r.primaryContainer.color, in: Capsule())
                }
            }
        }
        .padding(.horizontal, 18).padding(.top, 22).padding(.bottom, 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        .skSheet()
        .onChange(of: library) { _, item in
            Task {
                if let data = try? await item?.loadTransferable(type: Data.self) { save(data) }
            }
        }
        .sheet(isPresented: $camera) { CameraPicker { save($0) }.ignoresSafeArea() }
        .task { await DeskLaunch.attachSampleProof { save($0) } }
    }

    private func save(_ data: Data) {
        guard let jpeg = PhotoPrep.jpeg(from: data) else { return }
        let saved = graph.writes.photo(
            clinicSlug: clinic.slug, patientId: patientId, id: UUID().uuidString.lowercased(),
            jpeg: jpeg.kotlinBytes, label: label.apiLabel, tooth: nil
        )
        switch onEnum(of: saved) {
        case .saved: onDone()
        case .refused: problem = p9("p9.photo.refused")
        }
    }
}
