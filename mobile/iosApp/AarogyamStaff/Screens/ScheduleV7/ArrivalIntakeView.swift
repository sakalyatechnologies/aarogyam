import AarogyamShared
import SakalyaUI
import SwiftUI

/// What the patient told the QR form beyond the basics, read-only: "Label: value" lines, then the checklist.
struct ArrivalIntakeView: View {
    let intake: ArrivalIntake
    @Environment(\.skTheme) private var theme

    var body: some View {
        if !intake.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(intake.lines.enumerated()), id: \.offset) { _, detail in
                    Text(String(format: iv("iv.in.line"), label(detail.line), value(detail))).font(.subheadline)
                }
                if !intake.health.isEmpty {
                    Text(String(format: iv("iv.in.line"), iv("iv.in.health"), intake.health.joined(separator: ", ")))
                        .font(.subheadline.weight(.semibold))
                }
            }
            .foregroundStyle(theme.roles.onSurfaceVariant.color)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func value(_ detail: IntakeDetail) -> String {
        guard let answer = detail.answer else { return detail.value }
        return answer.boolValue ? iv("iv.yes") : iv("iv.no")
    }

    private func label(_ line: IntakeLine) -> String {
        switch line {
        case .bloodGroup: iv("iv.blood")
        case .altPhone: iv("iv.alt.phone")
        case .emergencyContact: iv("iv.in.emergency")
        case .referredBy: iv("iv.referred")
        case .callTime: iv("iv.call.time")
        case .occupation: iv("iv.occupation")
        case .heardVia: iv("iv.heard")
        case .familyDoctor: iv("iv.doctor.name")
        case .familyDoctorAddress: iv("iv.doctor.address")
        case .healthOther: iv("iv.health.other")
        case .allergies: iv("iv.allergies.text")
        case .pregnant: iv("iv.pregnant")
        case .dueDate: iv("iv.due.date")
        case .nursing: iv("iv.nursing")
        }
    }
}
