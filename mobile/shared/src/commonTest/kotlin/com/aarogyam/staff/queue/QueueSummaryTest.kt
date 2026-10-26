package com.aarogyam.staff.queue

import com.aarogyam.staff.patients.Sex
import kotlin.test.Test
import kotlin.test.assertEquals

class QueueSummaryTest {
    private fun row(
        n: Int,
        status: TokenStatus,
        wait: Long,
    ) = QueueRow("t$n", n, "p$n", "Patient $n", "SD-$n", 30, Sex.Female, status, wait, null)

    @Test
    fun waits_are_averaged_over_those_still_waiting() {
        val s =
            QueueSummary.of(
                listOf(
                    row(1, TokenStatus.Waiting, 10),
                    row(2, TokenStatus.Waiting, 25),
                    row(3, TokenStatus.InChair, 40),
                    row(4, TokenStatus.Done, 5),
                    row(5, TokenStatus.Left, 60),
                ),
            )
        assertEquals(QueueSummary(2, 1, 1, 1, 17, 25), s)
    }

    @Test
    fun an_empty_waiting_room_has_no_wait() {
        assertEquals(QueueSummary(0, 0, 0, 0, null, null), QueueSummary.of(emptyList()))
    }
}
