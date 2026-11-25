import AarogyamShared
import SakalyaUI
import SwiftUI

/// "N checked in by QR" on the desk queue; a tap opens the sheet where each arrival is accepted or dismissed.
struct ArrivalsStrip: View {
    let holder: ArrivalsHolder
    @State private var open = false
    @State private var model: ScreenModel<ArrivalsHolder, ArrivalsState>?
    @Environment(\.skTheme) private var theme

    var body: some View {
        VStack(spacing: 0) {
            if let model, case .shown(let shown) = onEnum(of: model.value) {
                content(holder, shown)
            }
        }
        .onAppear {
            if model == nil { model = ScreenModel(make: { _ in holder }, state: { $0.state }) }
        }
    }

    @ViewBuilder private func content(_ holder: ArrivalsHolder, _ shown: ArrivalsStateShown) -> some View {
        let r = theme.roles
        if shown.count > 0 {
            Button { open = true } label: {
                Text(String(format: String(localized: "checkin.strip"), Int(shown.count)))
                    .font(.system(size: 13.5, weight: .bold)).foregroundStyle(r.onTertiaryContainer.color)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14).frame(minHeight: 44)
                    .background(r.tertiaryContainer.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.skPressable)
            .padding(.top, 8)
        }
        Color.clear.frame(height: 0)
            .sheet(isPresented: $open, onDismiss: { holder.clearMessage() }) {
                ArrivalsSheet(holder: holder, shown: shown)
            }
            .onChange(of: shown.count) { _, count in if count == 0 && shown.notice == nil { open = false } }
    }
}

private struct ArrivalsSheet: View {
    let holder: ArrivalsHolder
    let shown: ArrivalsStateShown
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        SkSheetScaffold(String(localized: "checkin.title")) {
            VStack(alignment: .leading, spacing: 12) {
                if shown.notice != nil {
                    Text("checkin.handled").font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                }
                if let error = shown.error {
                    Text(error.message).font(.footnote.weight(.semibold)).foregroundStyle(r.error.color)
                }
                if shown.rows.isEmpty {
                    Text("checkin.empty").skTextStyle(SkTypeScale.body).foregroundStyle(r.onSurfaceVariant.color)
                }
                ForEach(shown.rows, id: \.id) { row in
                    ArrivalCard(holder: holder, row: row, canAccept: shown.canAccept)
                }
            }
        }
        .skSheet()
    }
}

private struct ArrivalCard: View {
    let holder: ArrivalsHolder
    let row: ArrivalRow
    let canAccept: Bool
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 8) {
            Text(row.name).font(.body.weight(.bold)).foregroundStyle(r.onSurface.color)
            Text(row.phone).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color)
            if !row.reasons.isEmpty {
                Text(row.reasons.joined(separator: ", ")).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color)
            }
            if canAccept {
                if !row.matches.isEmpty {
                    Text("checkin.pick").font(.footnote).foregroundStyle(r.onSurfaceVariant.color)
                }
                GroupedCard {
                    ForEach(row.matches, id: \.id) { match in
                        PatientChoiceRow(
                            title: match.name,
                            line: patientLine(number: match.number, ageYears: match.ageYears?.intValue, sex: match.sex),
                            on: row.chosenPatientId == match.id
                        ) { holder.choose(id: row.id, patientId: match.id) }
                        GroupedDivider()
                    }
                    PatientChoiceRow(title: String(localized: "checkin.new_patient"), line: nil, on: row.chosenPatientId == nil, new: true) {
                        holder.choose(id: row.id, patientId: nil)
                    }
                }
            }
            HStack(spacing: 8) {
                if canAccept {
                    SkPillButton(String(localized: "checkin.add"), wide: true) { holder.accept(id: row.id, practitionerId: nil) }.disabled(row.busy)
                }
                SkPillButton(String(localized: "checkin.dismiss"), variant: .tonal, wide: true) { holder.dismiss(id: row.id) }.disabled(row.busy)
            }
        }
        .padding(12)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
