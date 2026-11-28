import SwiftUI

/// The printed poster: clinic name, a big caption and the QR. Rendered to a PDF for the system print sheet,
/// the same way the desk receipt prints.
struct PatientQRPoster: View {
    let image: UIImage
    let clinicName: String
    let caption: String

    var body: some View {
        VStack(spacing: 28) {
            Text(clinicName).font(.system(size: 34, weight: .heavy)).multilineTextAlignment(.center)
            Text(caption).font(.system(size: 52, weight: .black)).multilineTextAlignment(.center)
            Image(uiImage: image).interpolation(.none).resizable().scaledToFit().frame(width: 420, height: 420)
        }
        .padding(48)
        .frame(width: 595, alignment: .center)
        .foregroundStyle(.black)
        .background(.white)
    }
}

enum PosterPrinter {
    /// Renders the poster for [url] and presents the print sheet. Logs nothing: the link and clinic name stay out of logs.
    @MainActor static func print(url: String, clinicName: String, caption: String) {
        guard let image = QRCode.image(for: url) else { return }
        let renderer = ImageRenderer(content: PatientQRPoster(image: image, clinicName: clinicName, caption: caption))
        renderer.proposedSize = ProposedViewSize(width: 595, height: nil)
        let pdf = NSMutableData()
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let consumer = CGDataConsumer(data: pdf as CFMutableData),
                  let context = CGContext(consumer: consumer, mediaBox: &box, nil) else { return }
            context.beginPDFPage(nil)
            draw(context)
            context.endPDFPage()
            context.closePDF()
        }
        guard pdf.length > 0 else { return }
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = caption
        info.outputType = .general
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItem = pdf as Data
        controller.present(animated: true)
    }
}
