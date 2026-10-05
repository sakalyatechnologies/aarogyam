import SwiftUI
import Shared

// MARK: - 32-tooth FDI chart (mirrors ToothChart on Android)

private let upperArch = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28]
private let lowerArch = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]

struct ToothChartView: View {
    let teeth: [ToothRecord]
    @Binding var selected: ToothFdi?

    private var byFdi: [Int32: ToothRecord] {
        Dictionary(uniqueKeysWithValues: teeth.map { (Int32($0.fdi.number), $0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            archLabel("UPPER ARCH")
            toothRow(upperArch)
            archLabel("LOWER ARCH")
            toothRow(lowerArch)
        }
    }

    private func archLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption2).bold()
            .foregroundStyle(.secondary)
            .tracking(1.2)
    }

    private func toothRow(_ numbers: [Int]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 16), spacing: 3) {
            ForEach(numbers, id: \.self) { n in
                let record = byFdi[Int32(n)]
                let status = record?.status ?? .healthy
                ToothCell(
                    number: n,
                    status: status,
                    isSelected: selected?.number == Int32(n)
                ) {
                    // No force-unwrap: ToothFdi's init validates via Kotlin require
                    selected = ToothFdi(number: Int32(n))
                }
            }
        }
    }
}

private struct ToothCell: View {
    let number: Int
    let status: ToothStatus
    let isSelected: Bool
    let onTap: () -> Void

    @Environment(\.clinicPalette) private var palette

    private var colors: (border: Color, fill: Color, text: Color) {
        switch status {
        case .healthy:   return (.gray.opacity(0.35), .clear, .secondary)
        case .treated:   return (.green, .green.opacity(0.14), .green)
        case .rootcanal: return (.indigo, .indigo.opacity(0.14), .indigo)
        case .planned:   return (.orange, .orange.opacity(0.14), .orange)
        case .watch:     return (.red, .clear, .red)
        @unknown default: return (.gray.opacity(0.35), .clear, .secondary)
        }
    }

    var body: some View {
        Text("\(number)")
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(colors.text)
            .frame(maxWidth: .infinity)
            .aspectRatio(0.8, contentMode: .fit)
            .background(colors.fill)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .strokeBorder(
                        isSelected ? palette.brand : colors.border,
                        lineWidth: isSelected ? 2.5 : 1.5
                    )
            )
            .onTapGesture(perform: onTap)
    }
}
