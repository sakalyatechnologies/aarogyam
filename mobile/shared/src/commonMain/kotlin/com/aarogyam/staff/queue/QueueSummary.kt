package com.aarogyam.staff.queue

/**
 * The queue's summary chips, worked out from the tokens already loaded. No-shows are
 * appointments, not tokens; they come with the queue state (`QueueState.Loaded.noShows`).
 */
data class QueueSummary(
    val waiting: Int,
    val inChair: Int,
    val done: Int,
    /** Tokens that left without being seen. */
    val left: Int,
    /** Average wait of those still waiting, in minutes; null when nobody waits. */
    val averageWaitMinutes: Int?,
    /** The longest current wait, in minutes; null when nobody waits. */
    val longestWaitMinutes: Int?,
) {
    companion object {
        /** Summarises [rows]. */
        fun of(rows: List<QueueRow>): QueueSummary {
            val waiting = rows.filter { it.status == TokenStatus.Waiting || it.status == TokenStatus.Called }
            return QueueSummary(
                waiting = waiting.size,
                inChair = rows.count { it.status == TokenStatus.InChair },
                done = rows.count { it.status == TokenStatus.Done },
                left = rows.count { it.status == TokenStatus.Left },
                averageWaitMinutes =
                    if (waiting.isEmpty()) {
                        null
                    } else {
                        (waiting.sumOf { it.waitMinutes } / waiting.size)
                            .toInt()
                    },
                longestWaitMinutes = waiting.maxOfOrNull { it.waitMinutes }?.toInt(),
            )
        }
    }
}
