import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Files the clinics shared: tap an image or a PDF to read it here.
struct FilesScreen: View {
    let graph: PatientGraph

    var body: some View {
        ScreenHost(make: { graph.files(screen: $0, cache: IosFileCache()) }, state: { $0.state }) { holder, state in
            FilesContent(holder: holder, state: state)
        }
        .navigationTitle(String(localized: "files.title"))
    }
}

private struct FilesContent: View {
    let holder: FilesStateHolder
    let state: FilesState
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                if state.loading {
                    ProgressView().frame(maxWidth: .infinity).padding(SkSpacing.xxl)
                }
                if let error = state.error {
                    SkEmptyState(error.message, message: "", actionTitle: String(localized: "try_again"), action: holder.refresh)
                }
                if let error = state.openError {
                    SkCard { Text(error.message).skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.text.color) }
                }
                if !state.loading, state.error == nil, state.files.isEmpty {
                    SkCard {
                        Text("files.empty").skTextStyle(SkTypeScale.body).foregroundStyle(theme.palette.textMuted.color)
                    }
                }
                if !state.files.isEmpty {
                    SkCard(padding: 0) {
                        ForEach(state.files, id: \.id) { file in
                            Button { holder.open(file: file) } label: {
                                SkListRow(
                                    file.title,
                                    subtitle: file.subtitle,
                                    leading: {
                                        Image(systemName: file.kind == .pdf ? "doc.text" : "photo")
                                            .foregroundStyle(theme.palette.textMuted.color)
                                    },
                                    trailing: {
                                        Text(file.trailing(opening: state.opening == file.id))
                                            .skTextStyle(SkTypeScale.footnote).foregroundStyle(theme.palette.textMuted.color)
                                    }
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(SkSpacing.l)
        }
        .refreshable { holder.refresh() }
        .fullScreenCover(isPresented: Binding(get: { state.opened != nil }, set: { if !$0 { holder.close() } })) {
            if let opened = state.opened {
                FileViewer(opened: opened, onClose: holder.close)
            }
        }
    }
}

extension FileView {
    var title: String {
        if let label, !label.isEmpty { return label }
        if let caption, !caption.isEmpty { return caption }
        switch category {
        case "xray": return String(localized: "file.xray")
        case "photo": return String(localized: "file.photo")
        case "report": return String(localized: "file.report")
        case "consent": return String(localized: "file.consent")
        default: return String(localized: "file.document")
        }
    }

    var subtitle: String {
        let when = (takenAt ?? createdAt)?.dateText ?? ""
        return "\(clinicName) · \(when)"
    }

    func trailing(opening: Bool) -> String {
        if opening { return String(localized: "files.opening") }
        return kind == .other ? String(localized: "files.cant_open") : ""
    }
}
