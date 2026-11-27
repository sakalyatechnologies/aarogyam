import AarogyamShared
import SakalyaUI
import SwiftUI

/// After Record: Print the receipt, share it to WhatsApp as text, or email it (messages.send only).
struct DeskReceiptActions: View {
    let receipt: Receipt
    let patientName: String
    let email: ReceiptEmailHolder
    @State private var emailState: ReceiptEmail = ReceiptEmailIdle.shared
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                SkPillButton(dv("d9.pay.print"), variant: .tonal, wide: true) { printReceipt() }
                ShareLink(item: receipt.shareText()) {
                    Text(dv("d9.pay.whatsapp")).font(.system(size: 14, weight: .bold))
                        .foregroundStyle(theme.roles.onPrimaryContainer.color)
                        .frame(maxWidth: .infinity, minHeight: SkSpacing.minTouchTarget)
                        .background(theme.roles.primaryContainer.color, in: Capsule())
                }
                if email.canEmail {
                    SkPillButton(dv("d9.pay.email"), variant: .tonal, wide: true, loading: emailState is ReceiptEmailSending) { email.send(receipt: receipt) }
                }
            }
            if let note = emailNote {
                Text(note.text).v7Text(12.5, .semibold)
                    .foregroundStyle(note.good ? theme.roles.onSurfaceVariant.color : theme.roles.error.color)
                    .multilineTextAlignment(.center)
            }
        }
        .task { for await next in email.state { emailState = next } }
    }

    private var emailNote: (text: String, good: Bool)? {
        switch onEnum(of: emailState) {
        case .idle, .sending: nil
        case .queued: (dv("d9.pay.email.queued"), true)
        case .noEmail: (dv("d9.pay.email.no.email"), false)
        case .noConsent: (dv("d9.pay.email.no.consent"), false)
        case .alreadySent: (dv("d9.pay.email.already"), true)
        case .failed: (dv("d9.pay.email.failed"), false)
        }
    }

    /// Renders the receipt page to a PDF and hands it to the system print sheet.
    @MainActor private func printReceipt() {
        let renderer = ImageRenderer(content: DeskReceiptPage(receipt: receipt, patientName: patientName))
        renderer.proposedSize = ProposedViewSize(width: 400, height: nil)
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
        info.jobName = receipt.number
        info.outputType = .general
        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printingItem = pdf as Data
        controller.present(animated: true)
    }
}

/// The printed receipt: clinic, receipt number, date, patient, amount, how it was paid and the bill it paid.
struct DeskReceiptPage: View {
    let receipt: Receipt
    let patientName: String

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(receipt.clinicName).font(.title2.weight(.heavy))
            Text(dv("d9.pay.rc.title")).font(.headline).foregroundStyle(.secondary)
            Divider()
            row(dv("d9.pay.rc.number"), receipt.number)
            row(dv("d9.pay.rc.date"), ClinicFormat.date(iso: receipt.receivedOn))
            row(dv("d9.pay.rc.patient"), patientName)
            if let bill = receipt.invoiceNumber { row(dv("d9.pay.rc.bill"), bill) }
            row(dv("d9.pay.rc.method"), methodLabel)
            Divider()
            row(dv("d9.pay.rc.amount"), ClinicFormat.rupees(paise: receipt.amountPaise), bold: true)
        }
        .padding(28)
        .frame(width: 400, alignment: .leading)
        .foregroundStyle(.black)
        .background(.white)
    }

    private var methodLabel: String {
        switch receipt.method {
        case "cash": PayMethod.cash.label
        case "upi": PayMethod.upi.label
        case "card": PayMethod.card.label
        default: receipt.method.capitalized
        }
    }

    private func row(_ label: String, _ value: String, bold: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.subheadline).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value).font(bold ? .title3.weight(.heavy) : .body.weight(.semibold)).multilineTextAlignment(.trailing)
        }
    }
}
