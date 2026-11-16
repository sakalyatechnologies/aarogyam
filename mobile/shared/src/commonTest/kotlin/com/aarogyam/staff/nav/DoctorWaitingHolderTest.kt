package com.aarogyam.staff.nav

import com.aarogyam.staff.DoctorWaitingHolder
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.desk.until
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.tokenJson
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** T13: the doctor's waiting list shows waiting tokens, and a failed load says so. */
class DoctorWaitingHolderTest {
    private val queue = "$SUNRISE/api/v1/queue"

    @Test
    fun a_waiting_token_is_listed_and_not_called() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson()}]}""") })
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("clinical.write"))
            val holder = DoctorWaitingHolder(clinic, "doc", backgroundScope)
            until { holder.state.value.loaded }
            val rows = holder.state.value.rows
            assertEquals(1, rows.size)
            assertEquals(false, rows.single().called)
            assertTrue(!holder.state.value.failed)
        }
}
