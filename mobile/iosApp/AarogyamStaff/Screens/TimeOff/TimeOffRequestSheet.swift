import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Request time off": a kind, the first and last day, and an optional reason. Closes once the server accepts it.
struct TimeOffRequestSheet: View {
    let holder: any TimeOffHolder
    let state: TimeOffState
    let zone: TimeZone
    let onClose: () -> Void
    @Environment(\.skTheme) private var theme
    @State private var kind: TimeOffKind = .vacation
    @State private var first = Date()
    @State private var last = Date()
    @State private var reason = ""
    @State private var sentAtOpen: Int32?

    var body: some View {
        let r = theme.roles
        SkSheetScaffold(TimeOffV10.t("timeoff.request")) {
            VStack(alignment: .leading, spacing: 12) {
                Picker(TimeOffV10.t("timeoff.kind"), selection: $kind) {
                    ForEach([TimeOffKind.vacation, .sick, .personal, .other], id: \.self) { Text(TimeOffV10.kindLabel($0)).tag($0) }
                }
                .pickerStyle(.menu)
                DatePicker(TimeOffV10.t("timeoff.first_day"), selection: $first, displayedComponents: .date)
                    .environment(\.timeZone, zone)
                    .onChange(of: first) { _, day in if last < day { last = day } }
                DatePicker(TimeOffV10.t("timeoff.last_day"), selection: $last, in: first..., displayedComponents: .date)
                    .environment(\.timeZone, zone)
                SkField(TimeOffV10.t("timeoff.reason"), text: $reason)
                if let e = state.error { Text(e.message).skTextStyle(SkTypeScale.footnote).foregroundStyle(r.error.color) }
                SkPillButton(TimeOffV10.t("timeoff.send"), variant: .fill, wide: true) {
                    holder.request(kind: kind, firstDay: TimeOffV10.iso(first, zone: zone), lastDay: TimeOffV10.iso(last, zone: zone),
                                   reason: reason.isEmpty ? nil : String(reason.prefix(200)))
                }
                .disabled(state.sending)
            }
        }
        .skSheet()
        .onAppear { sentAtOpen = state.sent }
        .onChange(of: state.sent) { _, now in if let start = sentAtOpen, now > start { onClose() } }
    }
}
