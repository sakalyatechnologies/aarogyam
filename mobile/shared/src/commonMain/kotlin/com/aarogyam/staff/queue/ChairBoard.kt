package com.aarogyam.staff.queue

/** An active chair of the clinic, from the cached rooms. */
data class QueueChair(
    val id: String,
    val name: String,
    val branchId: String,
)

/** One place on the chair board: a named chair with its patient or nobody, or a patient seated with no chair. */
data class ChairSlot(
    /** Null for a patient seated before chairs were chosen, or the stand-in slot when the clinic lists no chairs. */
    val chair: QueueChair?,
    val occupant: QueueRow?,
)

/**
 * The chair board. Each chair of the branches in today's queue, in the clinic's order, with the
 * patient whose token sits in it; then anyone in a chair the board doesn't know. A clinic that
 * lists no chairs gets one unnamed free slot while somebody waits, so "Seat next" stays reachable.
 */
internal fun chairBoard(
    rows: List<QueueRow>,
    chairs: List<QueueChair>,
): List<ChairSlot> {
    val seated = rows.filter { it.status == TokenStatus.InChair }
    val branches = rows.map { it.branchId }.toSet()
    val shown = chairs.filter { branches.isEmpty() || it.branchId in branches }
    val ids = shown.map { it.id }.toSet()
    val placed = shown.map { chair -> ChairSlot(chair, seated.firstOrNull { it.roomId == chair.id }) }
    val loose = seated.filter { it.roomId !in ids }.map { ChairSlot(null, it) }
    val standIn =
        if (shown.isEmpty() && rows.any { it.status == TokenStatus.Waiting || it.status == TokenStatus.Called }) {
            listOf(ChairSlot(null, null))
        } else {
            emptyList()
        }
    return placed + loose + standIn
}

/** The first free chair in [row]'s branch, or null when every chair is taken or none is listed. */
internal fun freeChairFor(
    row: QueueRow,
    board: List<ChairSlot>,
): QueueChair? = board.firstOrNull { it.occupant == null && it.chair?.branchId == row.branchId }?.chair
