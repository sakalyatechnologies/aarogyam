import AarogyamShared
import SakalyaUI
import SwiftUI

/// One profile on the number in the walk-in lookup (Clear Glass): toned initials, name, the mobile
/// number and the relation. Tapping the name opens the patient page. On the right: Book appointment
/// and Collect payment as icon buttons, then a glass-prominent Check in, or a Checked in pill once
/// they are in the queue.
struct DeskMatchRow: View {
    let profile: DeskProfile
    /// The person this relative is linked to, when the profile is a relative.
    let ofName: String?
    let canCollect: Bool
    var canBook = false
    let onCheckIn: () -> Void
    let onCollect: () -> Void
    var onOpen: () -> Void = {}
    var onBook: () -> Void = {}
    @Environment(\.skTheme) private var theme
    private var name: String { profile.name.isEmpty ? profile.initials : profile.name }

    var body: some View {
        HStack(spacing: 8) {
            Button(action: onOpen) { identity }
                .buttonStyle(.plain)
                .accessibilityHint(dv("d9.lookup.open.a11y"))
                .accessibilityIdentifier("desk.match.open")
            Spacer(minLength: 4)
            if canBook { iconButton("calendar", label: dv("d9.lookup.book"), id: "desk.match.book", action: onBook) }
            if canCollect { iconButton("indianrupeesign.circle", label: dv("d9.lookup.collect"), id: "desk.match.collect", action: onCollect) }
            if profile.checkedInToday {
                VStack(alignment: .trailing, spacing: 4) {
                    GroupedPill(text: dv("d9.lookup.checked_in"), kind: .warm)
                    if let state = profile.state { GroupedPill(text: state.title, kind: .tonal) }
                }
            } else {
                Button(action: onCheckIn) { Text(dv("d9.lookup.check_in")).font(.subheadline.weight(.bold)) }
                    .skGlassButton(prominent: true)
                    .accessibilityLabel(dvf("d9.lookup.check_in.a11y", name))
            }
        }
        .padding(.horizontal, GroupedSizes.rowPaddingH).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    /// Avatar, name, number line and relation: tapping it opens the patient page.
    private var identity: some View {
        let r = theme.roles
        return HStack(spacing: 12) {
            GroupedAvatar(name: name, initials: profile.initials)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.body.weight(.semibold)).foregroundStyle(r.onSurface.color)
                if let phone = profile.phone, !phone.isEmpty {
                    Text(phone).font(.subheadline).foregroundStyle(r.onSurfaceVariant.color).monospacedDigit()
                }
                if let relation = profile.relation, let ofName {
                    Text(dvf("d9.lookup.relation_of", DeskRelation.title(wire: relation), ofName)).font(.footnote.weight(.semibold))
                        .foregroundStyle(r.primary.color)
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func iconButton(_ systemImage: String, label: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage).font(.title3.weight(.semibold)).foregroundStyle(theme.roles.primary.color)
                .frame(width: SkSpacing.minTouchTarget, height: SkSpacing.minTouchTarget)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }
}

/// An action row at the foot of the matches card ("Someone new", "Add family member"): an icon in
/// the primary colour and the label, the whole row tappable.
struct DeskActionRow: View {
    let title: String
    let systemImage: String
    let action: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage).font(.body.weight(.semibold)).frame(width: 40).accessibilityHidden(true)
                Text(title).font(.body.weight(.semibold))
                Spacer(minLength: 0)
            }
            .foregroundStyle(theme.roles.primary.color)
        }
        .buttonStyle(GroupedRowStyle())
    }
}

/// The big number field of the lookup: a phone glyph and the digits in large tabular figures.
struct DeskNumberField: View {
    let label: String
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    @Environment(\.skTheme) private var theme

    var body: some View {
        GroupedCard {
            HStack(spacing: 10) {
                Image(systemName: "phone.fill").foregroundStyle(theme.roles.onSurfaceVariant.color).accessibilityHidden(true)
                TextField(dv("d9.lookup.placeholder"), text: $text)
                    .font(.title.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(theme.roles.onSurface.color)
                    .keyboardType(.namePhonePad).autocorrectionDisabled().textInputAutocapitalization(.words)
                    .focused(focused)
                    .accessibilityLabel(label)
            }
            .padding(.horizontal, 16).frame(minHeight: 60)
        }
    }
}
