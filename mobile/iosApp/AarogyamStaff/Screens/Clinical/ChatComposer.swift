import AarogyamShared
import PhotosUI
import SakalyaUI
import SwiftUI

/// The message box: a paperclip for a photo, the text, send, and (with `chat.notice`) a "Post as notice" switch.
struct ChatComposer: View {
    let holder: ChatThreadStateHolder
    let state: ThreadState
    @State private var choosing = false
    @State private var camera = false
    @State private var pickingLibrary = false
    @State private var library: PhotosPickerItem?
    @State private var unreadable = false
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let empty = state.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        VStack(spacing: 4) {
            if state.canNotice {
                Toggle(isOn: Binding(get: { state.notice }, set: { holder.setNotice(on: $0) })) {
                    Label(c11("c11.notice.toggle"), systemImage: "megaphone.fill").font(.system(size: 13, weight: .semibold))
                }
                .toggleStyle(.switch).tint(r.primary.color).frame(minHeight: SkSpacing.minTouchTarget)
            }
            HStack(alignment: .bottom, spacing: SkSpacing.sm) {
                Button { choosing = true } label: {
                    Image(systemName: "paperclip").font(.system(size: 18, weight: .semibold)).foregroundStyle(r.onSurfaceVariant.color).frame(width: 44, height: 44)
                }
                .accessibilityLabel(c11("c11.attach"))
                TextField(CL("c.chat.compose"), text: Binding(get: { state.draft }, set: { holder.setDraft(text: $0) }), axis: .vertical)
                    .font(.system(size: 15)).lineLimit(1...5)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(r.surface3.color, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                Button { holder.send() } label: {
                    Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold))
                        .foregroundStyle(r.onPrimary.color).frame(width: 44, height: 44)
                        .background((empty ? r.surface3 : r.primary).color, in: Circle())
                }
                .disabled(empty)
                .accessibilityLabel(CL("c.chat.send"))
            }
        }
        .padding(.horizontal, SkSpacing.l).padding(.vertical, SkSpacing.sm)
        .background(r.background.color)
        .confirmationDialog(c11("c11.attach"), isPresented: $choosing) {
            if CameraPicker.isAvailable { Button(c11("c11.photo.camera")) { camera = true } }
            Button(c11("c11.photo.library")) { pickingLibrary = true }
        }
        .photosPicker(isPresented: $pickingLibrary, selection: $library, matching: .images)
        .sheet(isPresented: $camera) { CameraPicker { send($0) }.ignoresSafeArea() }
        .onChange(of: library) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { send(data) } else { unreadable = true }
                library = nil
            }
        }
        .alert(c11("c11.photo.refused"), isPresented: Binding(get: { state.refused }, set: { if !$0 { holder.dismissRefused() } })) {
            Button(c11("c11.ok"), role: .cancel) {}
        }
        .alert(c11("c11.photo.unreadable"), isPresented: $unreadable) {
            Button(c11("c11.ok"), role: .cancel) {}
        }
    }

    /// Shrinks the photo on the phone (upright, no location data), then hands it to the thread.
    private func send(_ data: Data) {
        guard let jpeg = PhotoPrep.jpeg(from: data) else { unreadable = true; return }
        holder.sendPhoto(jpeg: jpeg.kotlinBytes)
    }
}
