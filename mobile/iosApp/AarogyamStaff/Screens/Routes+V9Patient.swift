import AarogyamShared
import SwiftUI

/// Where a History card or the Last visit card opens: a past visit's detail.
struct VisitDetailRoute: Hashable {
    let visitId: String
}

#if DEBUG && AARO_ENV_Local
/// Screenshot runs: `SIMCTL_CHILD_AAROGYAM_DEV_PTAB=history|consent` opens that tab,
/// `_DEV_VISIT=1` opens the newest visit, `_DEV_CONSENT_SHEET=1` the record sheet, `_DEV_MONEY=1` shows the amounts.
extension DevLaunch {
    static var patientTab9: PatientPageTab? {
        switch ProcessInfo.processInfo.environment["AAROGYAM_DEV_PTAB"] {
        case "history": .history
        case "consent": .consent
        case "overview": .overview
        default: nil
        }
    }

    static var openFirstVisit: Bool { ProcessInfo.processInfo.environment["AAROGYAM_DEV_VISIT"] == "1" }
    static var consentSheet: Bool { ProcessInfo.processInfo.environment["AAROGYAM_DEV_CONSENT_SHEET"] == "1" }
    static var showMoney: Bool { ProcessInfo.processInfo.environment["AAROGYAM_DEV_MONEY"] == "1" }
}
#endif
