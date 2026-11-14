import AarogyamShared
import SakalyaUI
import SwiftUI

/// One staged treatment: its name and tooth, then optional surfaces (M, D, O, B, L, named for that
/// tooth) and a material. Neither is needed, so the two-tap path (tooth, then treatment) stays.
struct V9ProcedureLine: View {
    @Binding var item: StagedProcedure
    /// The tooth on the chart, which names its surfaces; nil before the chart loads.
    let tooth: ToothView?
    let materials: [TermView]
    let locked: Bool
    let onRemove: () -> Void
    @Environment(\.skTheme) private var theme

    var body: some View {
        let r = theme.roles
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.term.label).v7Text(14.5, .bold).foregroundStyle(r.onSurface.color)
                    Text(V9f("v9v.proc.tooth", item.tooth)).v7Text(12).foregroundStyle(r.onSurfaceVariant.color)
                }
                Spacer(minLength: 8)
                if !locked {
                    Button(action: onRemove) {
                        V7Icon(name: "plus", size: 18, tint: r.onSurface.color).rotationEffect(.degrees(45))
                            .frame(width: 44, height: 44).background(r.surface3.color, in: Circle())
                    }
                    .accessibilityLabel(V9f("v9v.proc.remove.a11y", item.term.label))
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) { surfaces; material }
                VStack(alignment: .leading, spacing: 6) { surfaces; material }
            }
            .disabled(locked)
        }
    }

    private var surfaces: some View {
        HStack(spacing: 4) {
            ForEach([Surface.m, .o, .d, .b, .l], id: \.self) { surface in
                let name = tooth?.surfaceName(surface: surface)
                let label = name?.label ?? surface.genericLabel
                let on = item.surfaces.contains(surface)
                Button { toggle(surface) } label: {
                    Text(String(label.prefix(1)))
                        .v7Text(13, .bold)
                        .foregroundStyle((on ? theme.roles.onPrimary : theme.roles.onSurface).color)
                        .frame(width: 36, height: 36)
                        .background((on ? theme.roles.primary : theme.roles.surface3).color, in: Circle())
                        .frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.skPressable)
                .accessibilityLabel(label)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(V9("v9v.proc.surfaces"))
    }

    @ViewBuilder private var material: some View {
        if !materials.isEmpty {
            Menu {
                Button(V9("v9v.proc.material.none")) { item.material = nil }
                ForEach(materials, id: \.id) { term in Button(term.label) { item.material = term } }
            } label: {
                Text(item.material?.label ?? V9("v9v.proc.material"))
                    .v7Text(13.5, item.material == nil ? .regular : .semibold).lineLimit(1)
                    .foregroundStyle((item.material == nil ? theme.roles.onSurfaceVariant : theme.roles.onSurface).color)
                    .padding(.horizontal, 12).frame(minHeight: 44).background(theme.roles.surface3.color, in: Capsule())
            }
            .accessibilityLabel(V9("v9v.proc.material"))
            .accessibilityValue(item.material?.label ?? V9("v9v.proc.material.none"))
        }
    }

    private func toggle(_ surface: Surface) {
        if let at = item.surfaces.firstIndex(of: surface) { item.surfaces.remove(at: at) } else { item.surfaces.append(surface) }
    }
}
