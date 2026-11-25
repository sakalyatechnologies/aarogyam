import AarogyamPatientShared
import PDFKit
import SwiftUI
import UIKit

/// An image or a PDF from the cache, with a Done button. Zoom by pinching.
struct FileViewer: View {
    let opened: OpenedFile
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if opened.file.kind == .pdf {
                    PdfPages(path: opened.path)
                } else {
                    ZoomableImage(path: opened.path)
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(opened.file.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button(String(localized: "done"), action: onClose) }
            }
        }
    }
}

private struct PdfPages: UIViewRepresentable {
    let path: String

    func makeUIView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.document = PDFDocument(url: URL(fileURLWithPath: path))
        return view
    }

    func updateUIView(_ view: PDFView, context: Context) {}
}

/// A scroll view that pinches and pans one image.
private struct ZoomableImage: UIViewRepresentable {
    let path: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 6
        scroll.delegate = context.coordinator
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        let image = UIImageView(image: UIImage(contentsOfFile: path))
        image.contentMode = .scaleAspectFit
        image.isAccessibilityElement = true
        image.accessibilityLabel = String(localized: "file.image.description")
        image.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(image)
        NSLayoutConstraint.activate([
            image.leadingAnchor.constraint(equalTo: scroll.frameLayoutGuide.leadingAnchor),
            image.trailingAnchor.constraint(equalTo: scroll.frameLayoutGuide.trailingAnchor),
            image.topAnchor.constraint(equalTo: scroll.frameLayoutGuide.topAnchor),
            image.bottomAnchor.constraint(equalTo: scroll.frameLayoutGuide.bottomAnchor),
        ])
        context.coordinator.image = image
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {}

    final class Coordinator: NSObject, UIScrollViewDelegate {
        var image: UIImageView?
        func viewForZooming(in scrollView: UIScrollView) -> UIView? { image }
    }
}
