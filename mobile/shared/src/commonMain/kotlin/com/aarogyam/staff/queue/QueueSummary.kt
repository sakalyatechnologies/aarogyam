package com.aarogyam.staff.queue

/**
 * The queue's summary chips, worked out from the tokens already loaded (no extra request).
 * No-shows are appointments, not tokens, so they are a preview here (BK-17).
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
            val waiting = rows.filter { it.status == TokenStatus.Waiting }
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

        /** Shown as "needs server support" beside the chips. */
        const val NO_SHOWS_PREVIEW: Boolean = true
    }
}
