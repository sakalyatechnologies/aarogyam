package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class MissedHolderTest {
    private val route = "$SUNRISE/api/v1/appointments/missed"

    private fun row(id: String) =
        """{"appointment_id":"$id","patient_id":"p1","patient_number":"SD-1","practitioner_id":"d1","starts_at":"2026-11-01T04:00:00Z"}"""

    private suspend fun kotlinx.coroutines.test.TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("appointments.read"),
    ) = MissedHolder(openClinic(backend, testGraph(backend, backgroundScope), this, permissions), backgroundScope)

    @Test
    fun loaded_carries_the_date_and_the_no_shows() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"date":"2026-11-01","items":[${row("a1")},${row("a2")}]}""") })
            val holder = holder(backend)
            until { holder.state.value is MissedState.Loaded }
            val loaded = assertIs<MissedState.Loaded>(holder.state.value)
            assertEquals("2026-11-01", loaded.date)
            assertEquals(listOf("a1", "a2"), loaded.items.map { it.appointmentId })
        }

    @Test
    fun empty_day_is_loaded_with_no_items() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json("""{"date":"2026-11-01","items":[]}""") })
            val holder = holder(backend)
            until { holder.state.value is MissedState.Loaded }
            assertEquals(emptyList(), assertIs<MissedState.Loaded>(holder.state.value).items)
        }

    @Test
    fun failure_shows_failed_and_refresh_recovers() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.InternalServerError, "internal") })
            val holder = holder(backend)
            until { holder.state.value is MissedState.Failed }
            backend.on(route, { json("""{"date":"2026-11-01","items":[${row("a1")}]}""") })
            holder.refresh()
            until { holder.state.value is MissedState.Loaded }
        }

    @Test
    fun a_role_without_the_permission_asks_nothing() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("billing.read"))
            assertIs<MissedState.NotAllowed>(holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count(route))
        }
}
