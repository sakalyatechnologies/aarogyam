import AarogyamShared
import SakalyaUI
import SwiftUI

/// One conversation: a pinned notice on top, bubbles (mine on the right), pending and failed ones marked, a composer.
/// While it is open the thread polls every few seconds for newer messages.
struct ChatThreadPage: View {
    let holder: ChatThreadStateHolder
    let state: ThreadState
    @Environment(\.skTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    var body: some View {
        let r = theme.roles
        VStack(spacing: 0) {
            if let pinned = state.pinned { PinnedNotice(message: pinned) }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if state.loading && state.messages.isEmpty {
                            SkLoadingIndicator(CL("c.loading")).padding(SkSpacing.xxl)
                        } else if let error = state.error, state.messages.isEmpty {
                            SkEmptyState(CL("c.chat.title"), message: error.message)
                        } else if state.messages.isEmpty {
                            Text("c.chat.thread.empty", tableName: "ClinicalV7").font(.system(size: 13)).foregroundStyle(r.onSurfaceVariant.color).padding(SkSpacing.xxl)
                        }
                        ForEach(state.messages, id: \.clientId) { message in
                            Bubble(
                                message: message,
                                thumbURL: message.attachment.flatMap { state.thumbs[$0.id] },
                                onRetry: { holder.retry(clientId: message.clientId) },
                                onOpen: { holder.openAttachment(attachmentId: $0) },
                                onThumb: { holder.requestThumb(attachmentId: $0) }
                            ).id(message.clientId)
                        }
                    }
                    .padding(.horizontal, SkSpacing.l).padding(.vertical, SkSpacing.m)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: state.messages.count) { _, _ in
                    if let last = state.messages.last { withAnimation { proxy.scrollTo(last.clientId, anchor: .bottom) } }
                }
            }
            ChatComposer(holder: holder, state: state)
        }
        .background(r.background.color)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: scenePhase) {
            // Polls only while the app is in front.
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                holder.poll()
            }
        }
        .onChange(of: state.link?.url) { _, url in
            // A file (not a picture) goes to the system; the link is never kept.
            guard let link = state.link, !link.image else { return }
            if let target = ChatFile.openable(link.url) { openURL(target) }
            holder.closeLink()
        }
        .fullScreenCover(isPresented: Binding(get: { state.link?.image == true }, set: { if !$0 { holder.closeLink() } })) {
            if let link = state.link { ChatImageViewer(link: link) { holder.closeLink() } }
        }
        .alert(c11("c11.file.open_failed"), isPresented: Binding(get: { state.linkFailed }, set: { if !$0 { holder.closeLink() } })) {
            Button(c11("c11.ok"), role: .cancel) {}
        }
    }
}

/// The newest notice, above the messages.
private struct PinnedNotice: View {
    let message: MessageView
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "megaphone.fill").font(.system(size: 15, weight: .bold)).foregroundStyle(r.onTertiaryContainer.color)
            VStack(alignment: .leading, spacing: 1) {
                if let author = message.author {
                    Text(author).font(.system(size: 11, weight: .bold)).foregroundStyle(r.onTertiaryContainer.color.opacity(0.8))
                }
                Text(message.body ?? "").font(.system(size: 13.5, weight: .semibold)).foregroundStyle(r.onTertiaryContainer.color).lineLimit(3)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, SkSpacing.l).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(r.tertiaryContainer.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(c11("c11.pinned.a11y") + ", " + (message.body ?? ""))
    }
}

/// A picture shown full screen.
private struct ChatImageViewer: View {
    let link: AttachmentLink
    let onClose: () -> Void
    @State private var image: UIImage?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            if let image {
                Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button(action: onClose) {
                Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 44, height: 44).background(.black.opacity(0.5), in: Circle())
            }
            .padding(12).accessibilityLabel(c11("c11.close"))
        }
        .task {
            guard let url = ChatFile.openable(link.url), let (data, _) = try? await URLSession.shared.data(from: url) else { return }
            image = UIImage(data: data)
        }
    }
}
