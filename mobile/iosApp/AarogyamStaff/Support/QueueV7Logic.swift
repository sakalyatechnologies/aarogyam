import Foundation

/// The v7 queue board's rules, apart from the views so they can be tested.
enum QueueBoard {
    /// Chairs with nobody in them. The clinic's chair list is the capacity; when it is not known,
    /// one free chair is offered while somebody waits so "Seat next" stays reachable.
    static func freeChairs(chairs: Int, occupied: Int, waiting: Int) -> Int {
        if chairs <= 0 { return waiting > 0 ? 1 : 0 }
        return max(chairs - occupied, 0)
    }

    /// A ticket's wait now: the minutes the server reported plus the time since they were read.
    static func waitMinutes(base: Int, elapsed: TimeInterval) -> Int {
        max(base, 0) + max(Int(elapsed / 60), 0)
    }
}
