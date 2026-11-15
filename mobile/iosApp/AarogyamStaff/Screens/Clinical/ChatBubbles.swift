import AarogyamShared
import SakalyaUI
import SwiftUI

/// One message: text, a notice card, or a file; mine on the right.
struct Bubble: View {
    let message: MessageView
    let thumbURL: String?
    let onRetry: () -> Void
    let onOpen: (String) -> Void
    let onThumb: (String) -> Void
    let onThumbFailed: (String) -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        HStack {
            if message.mine { Spacer(minLength: 56) }
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 2) {
                if !message.mine, let author = message.author {
                    Text(author).font(.system(size: 11, weight: .bold)).foregroundStyle(r.onSurfaceVariant.color)
                }
                content.opacity(message.pending ? 0.6 : 1)
                if message.failed {
                    Button(action: onRetry) {
                        Text("c.chat.failed", tableName: "ClinicalV7").font(.system(size: 11.5, weight: .bold)).foregroundStyle(r.error.color).frame(minHeight: 32)
                    }
                } else if message.pending {
                    Text("c.chat.sending", tableName: "ClinicalV7").font(.system(size: 11)).foregroundStyle(r.onSurfaceVariant.color)
                } else if !message.at.isEmpty {
                    Text(ClinicalFormat.chatTime(message.at)).font(.system(size: 10.5)).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            if !message.mine { Spacer(minLength: 56) }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var content: some View {
        let r = theme.roles
        if message.deleted {
            textCard(CL("c.chat.deleted"), italic: true)
        } else {
            VStack(alignment: message.mine ? .trailing : .leading, spacing: 4) {
                if let file = message.attachment { attachment(file) }
                if let body = message.body, !body.isEmpty {
                    if message.notice { noticeCard(body) } else { textCard(body, italic: false) }
                }
            }
            .background(Color.clear)
            .tint(r.primary.color)
        }
    }

    private func textCard(_ text: String, italic: Bool) -> some View {
        let r = theme.roles
        return Text(text).font(.system(size: 15)).italic(italic)
            .foregroundStyle((message.mine ? r.onPrimary : r.onSurface).color)
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background((message.mine ? r.primary : r.card).color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func noticeCard(_ text: String) -> some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 5) {
                Image(systemName: "megaphone.fill").font(.system(size: 12, weight: .bold))
                Text(c11("c11.notice")).font(.system(size: 11, weight: .heavy))
            }
            Text(text).font(.system(size: 15))
        }
        .foregroundStyle(r.onTertiaryContainer.color)
        .padding(.horizontal, 13).padding(.vertical, 9)
        .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(r.onTertiaryContainer.color.opacity(0.25), lineWidth: 1))
    }

    @ViewBuilder private func attachment(_ file: AttachmentView) -> some View {
        let r = theme.roles
        if file.image {
            Button { onOpen(file.id) } label: {
                ChatThumb(attachment: file, url: thumbURL, onRequest: { onThumb(file.id) }, onFailed: { onThumbFailed(file.id) })
            }
            .buttonStyle(.skPressable).disabled(file.id.isEmpty)
            .accessibilityLabel(c11("c11.photo.a11y"))
        } else {
            Button { onOpen(file.id) } label: {
                HStack(spacing: 8) {
                    Image(systemName: "doc.fill").font(.system(size: 18)).foregroundStyle(r.primary.color)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(file.fileName ?? c11("c11.file.a11y")).font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onSurface.color).lineLimit(1)
                        Text(ChatFile.sizeLabel(file.sizeBytes)).font(.system(size: 11)).foregroundStyle(r.onSurfaceVariant.color)
                    }
                }
                .padding(.horizontal, 12).padding(.vertical, 9).frame(minHeight: SkSpacing.minTouchTarget)
                .background(r.card.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.skPressable)
        }
    }
}

/// A picture thumbnail: asks for its link once, loads it, and keeps the picture (not the link) for next time.
private struct ChatThumb: View {
    let attachment: AttachmentView
    let url: String?
    let onRequest: () -> Void
    let onFailed: () -> Void
    @State private var image: UIImage?
    @Environment(\.skTheme) private var theme

    private static let cache = NSCache<NSString, UIImage>()

    var body: some View {
        let r = theme.roles
        ZStack {
            r.surface3.color
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "photo").font(.system(size: 24)).foregroundStyle(r.onSurfaceVariant.color)
            }
        }
        .frame(width: 200, height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .task(id: url) {
            if attachment.id.isEmpty { return }
            if let hit = Self.cache.object(forKey: attachment.id as NSString) { image = hit; return }
            guard let url else { onRequest(); return }
            // A link lasts five minutes; one that no longer loads is renewed through the holder.
            guard let target = ChatFile.openable(url), let (data, response) = try? await URLSession.shared.data(from: target),
                  (response as? HTTPURLResponse)?.statusCode == 200, let made = UIImage(data: data) else { onFailed(); return }
            let thumb = made.preparingThumbnail(of: CGSize(width: 600, height: 450)) ?? made
            Self.cache.setObject(thumb, forKey: attachment.id as NSString)
            image = thumb
        }
    }
}
