import AVFoundation
import AarogyamShared
import SakalyaUI
import SwiftUI
import UIKit

/// Records the doctor's voice beside the speech recogniser, so the audio can be uploaded with the note.
/// Best effort: when the microphone is busy no audio is kept and dictation still works.
@MainActor final class ChairRecorder {
    private var recorder: AVAudioRecorder?
    private var url: URL?
    private var startedAt: Date?

    /// 600 seconds is the most the upload accepts.
    func start() {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("chair-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        guard let made = try? AVAudioRecorder(url: file, settings: settings), made.record(forDuration: 600) else { return }
        recorder = made
        url = file
        startedAt = .now
    }

    /// The recording and its length in whole seconds; nil when nothing was recorded. The temp file is removed.
    func finish() -> (data: Data, seconds: Int)? {
        defer { recorder = nil; if let url { try? FileManager.default.removeItem(at: url) }; url = nil; startedAt = nil }
        guard let recorder, let url, let startedAt else { return nil }
        recorder.stop()
        guard let data = try? Data(contentsOf: url), !data.isEmpty else { return nil }
        return (data, max(1, Int(Date.now.timeIntervalSince(startedAt).rounded())))
    }
}

/// Full-screen, large targets for use at the chair: hands-free Dictate, a big Photo button and tooth chips.
/// The note saves by itself (every few seconds and when the screen closes).
struct ChairModeView: View {
    let graph: AppGraph
    let clinic: ClinicContext
    let patientId: String
    let holder: VisitStateHolder
    let view: VisitView_
    let onClose: () -> Void

    @State private var language: DictationLanguage = .english
    @State private var tooth: Int?
    @State private var camera = false
    @State private var toast: String?
    @State private var recorder = ChairRecorder()
    @State private var recording = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let listening = view.listening != nil
        VStack(spacing: SkSpacing.l) {
            HStack {
                Text(dv10("dv10.chair.title")).v7Text(22, .heavy).foregroundStyle(r.onSurface.color).accessibilityAddTraits(.isHeader)
                Spacer(minLength: 8)
                Button(dv10("dv10.chair.done")) { finishUp() }.v7Text(17, .bold).frame(minWidth: 64, minHeight: 56)
            }
            HStack(spacing: SkSpacing.sm) {
                ForEach(DictationLanguage.allCases, id: \.self) { option in
                    SkChoiceChip(option.chipLabel, selected: (view.listening ?? language) == option) { if !listening { language = option } }
                }
            }
            .opacity(listening ? 0.6 : 1)
            bigButton(
                listening ? dv10("dv10.chair.stop") : dv10("dv10.chair.dictate"),
                icon: listening ? "stop.fill" : "mic.fill", filled: true,
                a11y: listening ? dv10("dv10.chair.stop.a11y") : dv10("dv10.chair.dictate.a11y")
            ) { toggleDictation(listening) }
            .accessibilityAddTraits(listening ? .isSelected : [])
            bigButton(dv10("dv10.chair.photo"), icon: "camera.fill", filled: false, a11y: dv10("dv10.chair.photo.a11y")) {
                if CameraPicker.isAvailable { camera = true } else { toast = dv10("dv10.chair.photo.nocamera") }
            }
            teeth
            Spacer(minLength: 0)
            HStack {
                if let toast { Text(toast).v7Text(14, .bold).foregroundStyle(r.onSurface.color) }
                Spacer(minLength: 8)
                Text(dv10("dv10.chair.autosave")).v7Text(13, .semibold).foregroundStyle(r.onSurfaceVariant.color)
            }
        }
        .padding(SkSpacing.l)
        .background(r.background.color.ignoresSafeArea())
        .fullScreenCover(isPresented: $camera) { CameraPicker { savePhoto($0) }.ignoresSafeArea() }
        .onChange(of: listening) { _, now in if !now && recording { endDictation() } }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(8))
                _ = try? await holder.saveNow()
            }
        }
        .onDisappear { if listening { holder.stopListening() }; Task { _ = try? await holder.saveNow() } }
    }

    private func bigButton(_ title: String, icon: String, filled: Bool, a11y: String, action: @escaping () -> Void) -> some View {
        let r = theme.roles
        return Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 40, weight: .bold)).accessibilityHidden(true)
                Text(title).v7Text(22, .heavy).lineLimit(2).minimumScaleFactor(0.7)
            }
            .foregroundStyle(filled ? r.onPrimary.color : r.onPrimaryContainer.color)
            .frame(maxWidth: .infinity, minHeight: 130)
            .background(filled ? r.primary.color : r.primaryContainer.color, in: RoundedRectangle(cornerRadius: 28))
        }
        .buttonStyle(.skPressable)
        .accessibilityLabel(a11y)
    }

    private var teeth: some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: SkSpacing.sm) {
            Text(dv10("dv10.chair.teeth")).v7Text(13, .heavy).foregroundStyle(r.onSurfaceVariant.color)
            ForEach([DoctorV10Teeth.upper, DoctorV10Teeth.lower], id: \.first) { arch in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(arch, id: \.self) { number in
                            SkChoiceChip(String(number), selected: tooth == number) { tooth = tooth == number ? nil : number }
                                .frame(minWidth: 52, minHeight: 52)
                                .accessibilityLabel(dv10f("dv10.chair.tooth.a11y", String(number)))
                        }
                    }
                }
            }
        }
    }

    private func toggleDictation(_ listening: Bool) {
        if listening {
            holder.stopListening()
        } else {
            holder.listen(language: language)
            recording = true
            Task {
                try? await Task.sleep(for: .milliseconds(800))
                if recording { recorder.start() }
            }
        }
    }

    /// The transcript is in the note: save it, then keep the recording for upload.
    private func endDictation() {
        recording = false
        let clip = recorder.finish()
        let tag = language.tag
        Task {
            _ = try? await holder.saveNow()
            guard let clip else { return }
            _ = graph.enqueueDictationAudio(
                clinic: clinic, patientId: patientId, visitId: view.visitId, noteId: nil,
                bytes: clip.data.kotlinBytes, durationSeconds: Int32(clip.seconds), language: tag
            )
        }
    }

    private func savePhoto(_ data: Data) {
        guard let jpeg = PhotoPrep.jpeg(from: data) else { return }
        let saved = graph.writes.photo(
            clinicSlug: clinic.slug, patientId: patientId, id: UUID().uuidString.lowercased(),
            jpeg: jpeg.kotlinBytes, label: PatientPhotoLabel.photo.apiLabel, tooth: tooth.map { KotlinInt(int: Int32($0)) }
        )
        switch onEnum(of: saved) {
        case .saved:
            toast = dv10("dv10.chair.photo.saved")
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .refused: toast = dv10("dv10.chair.photo.refused")
        }
    }

    private func finishUp() {
        if view.listening != nil { holder.stopListening() }
        onClose()
    }
}
