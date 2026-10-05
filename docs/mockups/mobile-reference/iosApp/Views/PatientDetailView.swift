import SwiftUI
import Shared

// MARK: - Patient 360 (mirrors PatientDetailScreen on Android)

struct PatientDetailView: View {
    let detail: PatientDetail
    @State private var tab = 0
    @State private var selectedTooth: ToothFdi?
    @State private var showShareSheet = false
    @Environment(\.clinicPalette) private var palette
    @Environment(\.dismiss) private var dismiss

    private let tabs = ["Chart", "Visits", "Rx", "Bills"]

    var body: some View {
        VStack(spacing: 0) {
            // Hero
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 14) {
                    Text(initials(of: detail.patient.name))
                        .font(.title2).bold().foregroundStyle(.white)
                        .frame(width: 60, height: 60)
                        .background(.green)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                    VStack(alignment: .leading) {
                        Text("\(detail.patient.fileNo) · \(detail.patient.age)y \(detail.patient.sex)")
                            .font(.caption).foregroundStyle(.secondary)
                        Text(detail.patient.headline)
                            .font(.subheadline).fontWeight(.medium)
                    }
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(detail.patient.flags, id: \.text) { flag in
                            Text(flag.text)
                                .font(.caption2).bold()
                                .foregroundStyle(flagColor(flag.kind))
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(flagColor(flag.kind).opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }
                }
            }
            .padding()

            // Segmented control — the iOS-native tab pattern
            Picker("", selection: $tab) {
                ForEach(tabs.indices, id: \.self) { i in Text(tabs[i]).tag(i) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)

            TabView(selection: $tab) {
                chartTab.tag(0)
                visitsTab.tag(1)
                rxTab.tag(2)
                billsTab.tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            // Actions
            HStack(spacing: 10) {
                Button("℞ Send Rx") {}
                    .buttonStyle(.borderedProminent)
                    .tint(palette.brand)
                    .frame(maxWidth: .infinity)
                Button("↗ Share report") { showShareSheet = true }
                    .buttonStyle(.bordered)
                    .tint(palette.brand)
                    .frame(maxWidth: .infinity)
            }
            .padding()
        }
        .navigationTitle(detail.patient.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showShareSheet) {
            ShareSheetView(patientName: detail.patient.name)
                .presentationDetents([.medium])
        }
    }

    // MARK: tabs

    private var chartTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Dental chart · FDI").font(.headline)
                ToothChartView(teeth: detail.teeth, selected: $selectedTooth)
                if let fdi = selectedTooth,
                   let record = detail.teeth.first(where: { $0.fdi.number == fdi.number }) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Tooth \(record.fdi.number) · \(record.displayName)").bold()
                        ForEach(record.treatments, id: \.title) { t in
                            VStack(alignment: .leading) {
                                Text("• \(t.title)").font(.subheadline)
                                Text(t.detail).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding()
                    .background(.thinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                } else {
                    Text("Tap a highlighted tooth to see its treatments.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding()
        }
    }

    private var visitsTab: some View {
        List(detail.visits, id: \.title) { v in
            VStack(alignment: .leading, spacing: 4) {
                Text(v.date).font(.caption).foregroundStyle(.secondary)
                Text(v.title).font(.subheadline).bold()
                Text(v.body).font(.subheadline)
            }
        }
        .listStyle(.plain)
    }

    private var rxTab: some View {
        List(detail.prescriptions, id: \.id) { rx in
            VStack(alignment: .leading, spacing: 6) {
                Text("℞ \(rx.id) · \(rx.date)").font(.subheadline).bold()
                ForEach(rx.items, id: \.self) { item in Text("• \(item)").font(.subheadline) }
                if rx.allergyCheckPassed {
                    Text("✓ Allergy check passed").font(.caption).bold().foregroundStyle(.green)
                }
            }
        }
        .listStyle(.plain)
    }

    private var billsTab: some View {
        List(detail.bills, id: \.id) { bill in
            HStack {
                VStack(alignment: .leading) {
                    Text(bill.id).font(.caption).foregroundStyle(.secondary)
                    Text("₹\(bill.amountPaise / 100)").font(.headline)
                }
                Spacer()
                Text(bill.state.name.uppercased()).font(.caption2).bold().foregroundStyle(palette.brand)
            }
        }
        .listStyle(.plain)
    }

    // MARK: helpers

    private func initials(of name: String) -> String {
        name.split(separator: " ").compactMap { $0.first }.map(String.init).joined()
    }

    private func flagColor(_ kind: FlagKind) -> Color {
        switch kind {
        case .alert: return .red
        case .warn:  return .orange
        case .ok:    return .green
        case .info:  return palette.brand
        @unknown default: return .gray
        }
    }
}

// MARK: - Share sheet: expiring report link (mirrors the blueprint's share_links)

private struct ShareSheetView: View {
    let patientName: String
    @State private var expiry = "24 hours"
    @State private var link: String?
    @Environment(\.clinicPalette) private var palette
    @Environment(\.dismiss) private var dismiss

    private let expiries = ["24 hours", "72 hours", "7 days"]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text("Treatment summary + prescriptions + x-rays. Opened with a one-time code; every access is logged.")
                    .font(.subheadline).foregroundStyle(.secondary)
                Text("Expires in").font(.headline)
                HStack {
                    ForEach(expiries, id: \.self) { e in
                        Button(e) { expiry = e }
                            .buttonStyle(.bordered)
                            .tint(expiry == e ? palette.brand : .secondary)
                    }
                }
                Button("Generate secure link") {
                    // Real implementation: POST /share-links → { url, otp }
                    link = "r.aarogyam.example/s/\(Int.random(in: 1000...9999))"
                }
                .buttonStyle(.borderedProminent)
                .tint(palette.brand)
                if let link {
                    Text(link).font(.system(.body, design: .monospaced))
                        .padding().frame(maxWidth: .infinity, alignment: .leading)
                        .background(.thinMaterial).clipShape(RoundedRectangle(cornerRadius: 12))
                    Text("Expires in \(expiry) · revocable anytime.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Share report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
