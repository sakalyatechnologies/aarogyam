import AarogyamShared
import SakalyaUI
import SwiftUI

/// Close visit: optional follow-up and fee, then the button; with an unsigned prescription the
/// button turns into a confirm card. The server takes the follow-up and fee with the close
/// (BE5); until then they are Preview.
struct V9CloseArea: View {
    @Binding var confirm: Bool
    @Binding var followUpOn: Bool
    @Binding var followUpDate: Date
    @Binding var feeText: String
    let closing: Bool
    let error: String?
    let onClose: () -> Void
    let onCloseAnyway: () -> Void
    let onSignNow: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: SkSpacing.ml) {
            V7Card {
                VStack(alignment: .leading, spacing: SkSpacing.m) {
                    HStack {
                        Text("v9v.close.after", tableName: "VisitV9").v7Text(16, .heavy).foregroundStyle(r.onSurface.color)
                        Spacer(minLength: 8)
                        V7Pill(text: V9("v9v.preview"), kind: .warm)
                    }
                    Toggle(isOn: $followUpOn.animation()) {
                        Text("v9v.close.follow_up", tableName: "VisitV9").v7Text(15)
                    }
                    .tint(r.primary.color).frame(minHeight: 44)
                    if followUpOn {
                        DatePicker(V9("v9v.close.follow_up.date"), selection: $followUpDate, in: Date.now..., displayedComponents: .date)
                            .v7Text(15).frame(minHeight: 44)
                    }
                    SkField(V9("v9v.close.fee"), text: $feeText, placeholder: V9("v9v.close.fee.hint"), keyboard: .numberPad)
                    Text("v9v.close.preview", tableName: "VisitV9").v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                }
            }
            if confirm {
                VStack(alignment: .leading, spacing: SkSpacing.m) {
                    Text("v9v.close.confirm.title", tableName: "VisitV9").v7Text(15, .heavy)
                    Text("v9v.close.confirm.message", tableName: "VisitV9").v7Text(13)
                    HStack(spacing: SkSpacing.sm) {
                        SkPillButton(V9("v9v.close.anyway"), variant: .tonal, wide: true, action: onCloseAnyway)
                        SkPillButton(V9("v9v.close.sign_now"), variant: .fill, wide: true, action: onSignNow)
                    }
                }
                .foregroundStyle(r.onTertiaryContainer.color)
                .padding(SkSpacing.ml).frame(maxWidth: .infinity, alignment: .leading)
                .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .transition(.opacity.combined(with: .move(edge: .bottom)))
                .accessibilityElement(children: .contain)
            } else {
                SkPillButton(CL("c.visit.close"), variant: .warm, icon: V7Icon.path("check"), wide: true, loading: closing, action: onClose)
                    .disabled(closing)
                Text("v9v.close.note", tableName: "VisitV9").v7Text(12).foregroundStyle(r.onSurfaceVariant.color).multilineTextAlignment(.center)
            }
            if let error { Text(error).v7Text(12.5, .semibold).foregroundStyle(r.error.color) }
        }
    }
}

/// After the visit closed: what was done, the bill and the way back to the patient.
struct V9Summary: View {
    let firstName: String
    let patientNumber: String
    let snapshot: V9Snapshot
    let minutes: Int
    let onBack: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(spacing: SkSpacing.ml) {
            V7Card {
                VStack(alignment: .leading, spacing: SkSpacing.m) {
                    row(V9("v9v.sum.treatment"), snapshot.procedures.isEmpty ? V9("v9v.sum.none") : snapshot.procedures.joined(separator: ", "))
                    row(V9("v9v.sum.notes"), snapshot.notes == 0 ? V9("v9v.sum.none") : V9f("v9v.sum.notes.value", snapshot.notes))
                    row(V9("v9v.sum.rx"), snapshot.medicines == 0 ? V9("v9v.sum.none") : V9f("v9v.sum.rx.value", snapshot.rxNumber ?? "", snapshot.medicines))
                    if let date = snapshot.followUp {
                        row(V9("v9v.sum.follow_up"), date.formatted(date: .abbreviated, time: .omitted) + " · " + V9("v9v.preview"))
                    }
                    Divider()
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("v9v.sum.bill", tableName: "VisitV9").v7Text(15, .heavy).foregroundStyle(r.onSurface.color)
                            Text(V9f("v9v.sum.time", minutes)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                        }
                        Spacer(minLength: 8)
                        Text(snapshot.feePaise.map { V9Close.rupees(paise: $0) } ?? V9("v9v.sum.bill.desk"))
                            .v7Text(snapshot.feePaise == nil ? 13 : 22, .heavy).foregroundStyle(r.onSurface.color).multilineTextAlignment(.trailing)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            SkPillButton(V9f("v9v.sum.back", firstName), variant: .fill, wide: true, action: onBack)
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        let r = theme.roles
        return VStack(alignment: .leading, spacing: 2) {
            Text(title).v7Text(14.5, .bold).foregroundStyle(r.onSurface.color)
            Text(value).v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
