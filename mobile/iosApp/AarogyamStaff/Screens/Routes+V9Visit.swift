import AarogyamShared
import SwiftUI

extension VisitRoute {
    /// The route from a queue token, with the chair the queue knows (the header says "In chair N").
    static func fromQueue(patientId: String, tokenId: String, chair: Int?) -> VisitRoute {
        VisitRoute(patientId: patientId, tokenId: tokenId, appointmentId: nil, chair: chair)
    }
}
