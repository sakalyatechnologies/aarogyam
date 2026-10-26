import Foundation
import Observation
// Named imports: the shared `Observation` model would otherwise hide Swift's `Observation` module
// from the `@Observable` macro, so this file cannot import the whole of AarogyamShared.
import class AarogyamShared.ClinicContext
import class AarogyamShared.ShareLink
import func AarogyamShared.onEnum

/// Creates the patient's link for one issued prescription (`POST /prescriptions/{id}/share`).
@MainActor @Observable
final class RxShareModel {
    enum Phase: Equatable { case idle, creating, failed, ready(url: URL, pin: String, expires: String?) }
    private(set) var phase = Phase.idle
    @ObservationIgnored private let clinic: ClinicContext

    init(clinic: ClinicContext) { self.clinic = clinic }

    func create(prescription id: String) async {
        phase = .creating
        guard let result = try? await clinic.api.sharePrescription(id: id), case .success(let ok) = onEnum(of: result),
              let link = ok.value as? ShareLink, let url = URL(string: clinic.api.origin + "/shared/" + link.token)
        else { phase = .failed; return }
        phase = .ready(url: url, pin: link.pin, expires: ClinicFormat.dateTime(iso8601: link.expiresAt, zone: clinic.session.clinic.timezone))
    }
}
