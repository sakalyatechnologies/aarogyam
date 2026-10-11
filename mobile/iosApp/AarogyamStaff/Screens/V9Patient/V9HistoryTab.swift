import AarogyamShared
import SakalyaUI
import SwiftUI

/// The History tab: one card per visit, newest first. A tap opens the visit's detail.
struct V9HistoryTab: View {
    let holder: VisitHistoryStateHolder
    let state: VisitHistoryState
    let clinic: ClinicContext
    let onOpen: (String) -> Void

    var body: some View {
        switch onEnum(of: state) {
        case .loading: V9SectionState(title: p9("p9.tab.history"), kind: .loading)
        case .notAllowed: V9SectionState(title: p9("p9.tab.history"), kind: .notAllowed)
        case .failed(let failed): V9SectionState(title: p9("p9.tab.history"), kind: .failed(failed.error), retry: holder.refresh)
        case .loaded(let loaded):
            VStack(alignment: .leading, spacing: 8) {
                if let error = loaded.error { V9ErrorLine(error: error) }
                if loaded.rows.isEmpty {
                    V7Card { V7Muted(p9("p9.history.none")).frame(maxWidth: .infinity) }
                } else {
                    let today = IosDates.todayISO(zone: clinic.session.clinic.timezone)
                    ForEach(loaded.rows, id: \.id) { row in
                        HistoryCard(row: row, todayISO: today) { onOpen(row.id) }
                    }
                }
            }
        }
    }
}

/// A History card: the date badge, the title, the doctor, and chips for what the visit holds.
struct HistoryCard: View {
    let row: VisitRow
    let todayISO: String
    let onTap: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        let iso = row.at.date.isoText
        let badge = HistoryRowFormat.badge(dateISO: iso, todayISO: todayISO)
        let chips = HistoryRowFormat.chips(
            hasNotes: row.hasNotes?.boolValue, hasRx: row.hasRx, hasPhotos: row.hasPhotos?.boolValue, bill: row.bill, open: row.open
        )
        let title = row.title ?? row.number
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 12) {
                VStack(spacing: 1) {
                    Text(badge.top).v7Text(badge.isToday ? 13 : 18, .heavy)
                    if let month = badge.bottom { Text(month).v7Text(11.5, .bold) }
                }
                .foregroundStyle((badge.isToday ? r.onPrimary : r.onPrimaryContainer).color)
                .frame(minWidth: 52, minHeight: 52).padding(.horizontal, 4)
                .background((badge.isToday ? r.primary : r.primaryContainer).color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).v7Text(14.5, .bold).foregroundStyle(r.onSurface.color).multilineTextAlignment(.leading)
                    Text(row.clinician).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                    if !chips.isEmpty {
                        V7Flow(spacing: 6) {
                            ForEach(chips, id: \.title) { chip in chipView(chip) }
                        }
                        .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                V7Icon(name: "chev", size: 18, tint: r.onSurfaceVariant.color)
            }
            .padding(.vertical, 12).padding(.leading, 12).padding(.trailing, 10)
            .background(r.card.color, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.skPressable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(([ClinicFormat.date(iso: iso), title, row.clinician] + chips.map(\.title)).joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
    }

    private func chipView(_ chip: HistoryRowFormat.Chip) -> some View {
        let r = theme.roles
        let (fill, ink): (Color, Color) = switch chip {
        case .paid: (r.primaryContainer.color, r.onPrimaryContainer.color)
        case .due: (r.errorContainer.color, r.onErrorContainer.color)
        case .open: (r.tertiaryContainer.color, r.onTertiaryContainer.color)
        default: (r.surface2.color, r.onSurfaceVariant.color)
        }
        return Text(chip.title).v7Text(11, .bold).foregroundStyle(ink)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(fill, in: Capsule())
    }
}
