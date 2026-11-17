import Foundation

/// The v7 queue board's rules, apart from the views so they can be tested.
enum QueueBoard {
    /// A ticket's wait now: the minutes the server reported plus the time since they were read.
    static func waitMinutes(base: Int, elapsed: TimeInterval) -> Int {
        max(base, 0) + max(Int(elapsed / 60), 0)
    }
}
