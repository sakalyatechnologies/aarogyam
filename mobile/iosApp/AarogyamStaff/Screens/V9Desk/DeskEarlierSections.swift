import AarogyamShared
import SakalyaUI
import SwiftUI

/// "Unpaid from earlier days": bills still to collect from before today. Hidden while loading, when the role
/// may not see it, on a failed first load, and when empty. Rows show the clinic number only (no names are fetched).
struct DeskUnpaidSection: View {
    let holder: ToCollectHolder
    let state: ToCollectState
    let canCollect: Bool
    /// Bumped by the home screen after a payment sheet or a pull to refresh.
    let refreshTick: Int
    let onCollect: (DeskPayTarget) -> Void
    @State private var expanded: Bool?
    @Environment(\.skTheme) private var theme

    var body: some View {
        Group {
            if case .loaded(let loaded) = onEnum(of: state), !loaded.items.isEmpty {
                let open = expanded ?? !DeskV10Earlier.startsCollapsed(count: loaded.items.count)
                VStack(alignment: .leading, spacing: 7) {
                    DeskEarlierHeader(title: DeskV10Earlier.unpaidHeader(count: loaded.items.count, totalPaise: loaded.totalPaise), open: open) {
                        expanded = !open
                    }
                    if open { ForEach(loaded.items, id: \.invoiceId) { row($0) } }
                }
                .padding(.top, 6)
            }
        }
        .onChange(of: refreshTick) { holder.refresh() }
    }

    private func row(_ item: ToCollectItem) -> some View {
        let r = theme.roles
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.patientNumber).v7Text(15, .bold).foregroundStyle(r.onSurface.color)
                Text(dxf("dx.earlier.token", Int(item.tokenNumber)) + " · " + DeskV10Earlier.dayText(item.day))
                    .v7Text(12.5).foregroundStyle(r.onSurfaceVariant.color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(DeskV10Earlier.unpaidRowLabel(number: item.patientNumber, token: Int(item.tokenNumber), day: item.day, balancePaise: item.balancePaise))
            Text(ClinicFormat.rupees(paise: item.balancePaise)).v7Text(15, .bold).foregroundStyle(r.onSurface.color)
                .accessibilityHidden(true)
            if canCollect {
                SkPillButton(dx("dx.earlier.collect"), variant: .tonal) {
                    onCollect(DeskPayTarget(patientId: item.patientId, name: item.patientNumber, invoiceId: item.invoiceId))
                }
                .frame(minHeight: SkSpacing.minTouchTarget)
                .accessibilityLabel(dxf("dx.earlier.collect.a11y", item.patientNumber))
            }
        }
        .padding(14).frame(minHeight: SkSpacing.minTouchTarget)
        .background(r.card.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// "Missed today": no-shows for the clinic day. A row opens the patient.
struct DeskMissedSection: View {
    let holder: MissedHolder
    let state: MissedState
    let zoneId: String
    let refreshTick: Int
    let onOpenPatient: (String) -> Void
    @State private var expanded: Bool?
    @Environment(\.skTheme) private var theme

    var body: some View {
        Group {
            if case .loaded(let loaded) = onEnum(of: state), !loaded.items.isEmpty {
                let open = expanded ?? !DeskV10Earlier.startsCollapsed(count: loaded.items.count)
                VStack(alignment: .leading, spacing: 7) {
                    DeskEarlierHeader(title: DeskV10Earlier.missedHeader(count: loaded.items.count), open: open) { expanded = !open }
                    if open { ForEach(loaded.items, id: \.appointmentId) { row($0) } }
                }
                .padding(.top, 6)
            }
        }
        .onChange(of: refreshTick) { holder.refresh() }
    }

    private func row(_ item: MissedAppointment) -> some View {
        let r = theme.roles
        let minute = DeskV10Feed.minuteOfDay(rfc3339: item.startsAt, zoneId: zoneId)
        return Button { onOpenPatient(item.patientId) } label: {
            HStack {
                Text(item.patientNumber).v7Text(15, .bold).foregroundStyle(r.onSurface.color)
                Spacer(minLength: 8)
                Text(DeskV10Earlier.timeText(minute: minute)).v7Text(13, .semibold).foregroundStyle(r.onSurfaceVariant.color)
            }
            .padding(14).frame(minHeight: SkSpacing.minTouchTarget)
            .background(r.card.color, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.skPressable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(DeskV10Earlier.missedRowLabel(number: item.patientNumber, minute: minute))
    }
}

/// The section title with its count and a chevron that folds the list.
private struct DeskEarlierHeader: View {
    let title: String
    let open: Bool
    let toggle: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 8) {
                Text(title).skTextStyle(SkTypeScale.headline).foregroundStyle(theme.roles.onSurface.color)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(theme.roles.onSurfaceVariant.color)
            }
            .frame(minHeight: SkSpacing.minTouchTarget).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityHint(dx(open ? "dx.earlier.collapse" : "dx.earlier.expand"))
        .accessibilityAddTraits(.isHeader)
    }
}
