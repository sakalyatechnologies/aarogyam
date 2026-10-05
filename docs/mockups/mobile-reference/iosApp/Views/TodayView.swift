import SwiftUI
import Shared

// MARK: - Today screen (mirrors TodayScreen on Android)

struct TodayView: View {
    let dashboard: TodayDashboard
    var onOpenPatient: (PatientId) -> Void = { _ in }
    @Environment(\.clinicPalette) private var palette

    var body: some View {
        NavigationStack {
            List {
                // Up-next hero
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("UP NEXT · \(dashboard.upNext.time)")
                            .font(.caption).bold()
                            .foregroundStyle(.white.opacity(0.75))
                        Text(dashboard.upNext.patientName)
                            .font(.title2).bold()
                            .foregroundStyle(.white)
                        Text("\(dashboard.upNext.title) · \(dashboard.upNext.chair)")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.85))
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        LinearGradient(colors: [palette.brandDark, palette.brand], startPoint: .topLeading, endPoint: .bottomTrailing)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                // Stats
                Section {
                    HStack(spacing: 10) {
                        ForEach(dashboard.stats, id: \.label) { stat in
                            VStack {
                                Text(stat.value).font(.title2).bold()
                                Text(stat.label).font(.caption).foregroundStyle(.secondary)
                                Text(stat.delta).font(.caption2).foregroundStyle(palette.brand)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(.thinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                    }
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }

                // Schedule — rows are tappable into Patient 360
                Section("Schedule") {
                    ForEach(dashboard.schedule, id: \.id.value) { appt in
                        Button {
                            // Real implementation resolves PatientId from the appointment
                            onOpenPatient(PatientId(value: "p-meera"))
                        } label: {
                            AppointmentRow(appt: appt)
                        }
                        .buttonStyle(.plain)
                    }
                }

                // Alerts
                Section("Needs attention") {
                    ForEach(dashboard.alerts, id: \.title) { alert in
                        HStack(alignment: .top, spacing: 12) {
                            Circle()
                                .fill(severityColor(alert.severity))
                                .frame(width: 10, height: 10)
                                .padding(.top, 5)
                            VStack(alignment: .leading) {
                                Text(alert.title).font(.subheadline).bold()
                                Text(alert.detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("＋", action: {})
                }
            }
        }
    }

    private func severityColor(_ kind: FlagKind) -> Color {
        switch kind {
        case .alert: return .red
        case .warn:  return .orange
        case .ok:    return .green
        case .info:  return palette.brand
        @unknown default: return .gray
        }
    }
}

private struct AppointmentRow: View {
    let appt: Appointment
    @Environment(\.clinicPalette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            Text(appt.patientInitials)
                .font(.headline).bold()
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(Color(red: 0.11, green: 0.45, blue: 0.35))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading) {
                Text(appt.patientName).font(.subheadline).bold()
                Text("\(appt.time) · \(appt.title)").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            stateChip(appt.state)
        }
    }

    @ViewBuilder
    private func stateChip(_ state: AppointmentState) -> some View {
        let (label, color): (String, Color) = switch state {
        case .done:    ("DONE", .green)
        case .waiting: ("WAITING", .orange)
        case .next:    ("NEXT", palette.brand)
        case .booked:  ("BOOKED", .indigo)
        @unknown default: ("", .gray)
        }
        Text(label)
            .font(.caption2).bold()
            .foregroundStyle(color)
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}
