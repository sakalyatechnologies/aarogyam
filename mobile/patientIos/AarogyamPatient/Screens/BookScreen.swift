import AarogyamPatientShared
import SakalyaUI
import SwiftUI

/// Booking: clinic, doctor, day, time, reason; the clinic's online booking rules apply.
struct BookScreen: View {
    let graph: PatientGraph
    let onDone: () -> Void

    var body: some View {
        ScreenHost(make: { graph.booking(screen: $0) }, state: { $0.state }) { holder, state in
            BookContent(holder: holder, state: state, onDone: onDone)
        }
        .navigationTitle(String(localized: "book.title"))
    }
}

private struct BookContent: View {
    let holder: BookingStateHolder
    let state: BookingState
    let onDone: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: SkSpacing.ml) {
                if let booked = state.booked {
                    SkHeroCard(
                        kicker: booked.status == .confirmed ? String(localized: "book.done.confirmed") : String(localized: "book.done.requested"),
                        title: booked.at?.text ?? "",
                        subtitle: booked.whoAndWhere
                    )
                    SkButton(String(localized: "done"), action: onDone)
                } else {
                    steps
                }
            }
            .padding(SkSpacing.l)
        }
    }

    @ViewBuilder private var steps: some View {
        let p = theme.palette
        if let error = state.error {
            SkCard { Text(error.message).skTextStyle(SkTypeScale.body).foregroundStyle(p.text.color) }
        }
        if state.clinics.count > 1 {
            heading("book.clinic")
            chips(state.clinics.map { ($0.id, $0.name) }, selected: state.clinicId) { holder.selectClinic(clinicId: $0) }
        }
        if !state.doctors.isEmpty {
            heading("book.doctor")
            chips(state.doctors.map { ($0.id, $0.name) }, selected: state.doctorId) { holder.selectDoctor(doctorId: $0) }
        }
        if state.doctorId != nil {
            heading("book.day")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(state.days, id: \.isoText) { day in
                        choice(ClinicFormat.date(iso: day.isoText), selected: state.day?.isoText == day.isoText) { holder.selectDay(day: day) }
                    }
                }
            }
            heading("book.time")
            if state.loading {
                ProgressView().frame(maxWidth: .infinity)
            } else if state.slots.isEmpty {
                Text("book.no_slots").skTextStyle(SkTypeScale.body).foregroundStyle(p.textMuted.color)
            } else {
                chips(state.slots.map { ($0.startsAt, $0.at?.timeText ?? $0.startsAt) }, selected: state.slot) { holder.selectSlot(startsAt: $0) }
            }
        }
        if state.slot != nil {
            SkTextField(String(localized: "book.reason"), text: Binding(get: { state.reason }, set: { holder.onReasonChange(text: $0) }))
            SkButton(String(localized: "book.confirm"), action: holder.book).disabled(state.booking)
        }
    }

    private func heading(_ key: String.LocalizationValue) -> some View {
        Text(String(localized: key)).skTextStyle(SkTypeScale.overline).foregroundStyle(theme.palette.textMuted.color)
    }

    private func chips(_ items: [(String, String)], selected: String?, pick: @escaping (String) -> Void) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: SkSpacing.sm)], alignment: .leading, spacing: SkSpacing.sm) {
            ForEach(items, id: \.0) { item in choice(item.1, selected: item.0 == selected) { pick(item.0) } }
        }
    }

    private func choice(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        let p = theme.palette
        return Button(action: action) {
            Text(title)
                .skTextStyle(SkTypeScale.footnote)
                .padding(.horizontal, SkSpacing.ml)
                .padding(.vertical, SkSpacing.sm)
                .frame(minHeight: 44)
                .foregroundStyle(selected ? p.onPrimary.color : p.text.color)
                .background(selected ? p.primary.color : p.card.color, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
