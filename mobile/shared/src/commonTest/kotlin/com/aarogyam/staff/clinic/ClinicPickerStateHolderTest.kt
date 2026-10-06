package com.aarogyam.staff.clinic

import com.aarogyam.staff.DEMO_APP
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.ME_TWO_CLINICS
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.config.AppEnvironment
import com.aarogyam.staff.json
import com.aarogyam.staff.sessionBody
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ClinicPickerStateHolderTest {
    @Test
    fun lists_clinics_from_the_app_host() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.clinicPicker(this, autoOpenSingle = true)

            val state = holder.state.first { it is ClinicPickerState.Choose } as ClinicPickerState.Choose
            assertEquals(listOf("sunrise", "lotus"), state.clinics.map { it.slug })
            assertEquals("Doctor", state.clinics[0].roleName)
            assertNull(graph.directory.current.value)
            val me = backend.requests.single { it.url.encodedPath == "/api/v1/me" }
            assertTrue(me.headers["Authorization"].orEmpty().startsWith("Bearer "))
            assertNotNull(me.headers["x-request-id"])
            assertEquals("aarogyam-staff/0.1.0", me.headers["x-client"])
        }

    @Test
    fun selecting_opens_the_clinic_by_host_and_caches_its_session() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
            backend.on("$SUNRISE/api/v1/session", { json(sessionBody()) })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.clinicPicker(this, autoOpenSingle = true)
            holder.state.first { it is ClinicPickerState.Choose }

            holder.select("sunrise")
            val opened =
                graph.directory.current
                    .filterNotNull()
                    .first()
            assertEquals("Sunrise Dental", opened.session.clinic.name)
            assertEquals(BrandMode.Dark, opened.branding.mode)
            assertEquals("Asia/Kolkata", opened.timeZone.id)

            // Back to the picker and in again: no second /me or /session.
            graph.directory.leave()
            val again = graph.clinicPicker(this, autoOpenSingle = false)
            again.state.first { it is ClinicPickerState.Choose }
            again.select("sunrise")
            graph.directory.current
                .filterNotNull()
                .first()
            assertEquals(1, backend.count("$DEMO_APP/api/v1/me"))
            assertEquals(1, backend.count("$SUNRISE/api/v1/session"))
            // The clinic is chosen by host only (product rule 1).
            assertTrue(
                backend.requests.none { r ->
                    r.headers.names().any { it.contains("clinic", ignoreCase = true) }
                },
            )
        }

    @Test
    fun a_single_clinic_opens_without_a_tap() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$DEMO_APP/api/v1/me",
                {
                    json(
                        """{"clinics":[{"org_id":"o1","slug":"sunrise","name":"Sunrise Dental","role_key":"doctor","role_name":"Doctor"}],"console_access":false}""",
                    )
                },
            )
            backend.on("$SUNRISE/api/v1/session", { json(sessionBody()) })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            graph.clinicPicker(this, autoOpenSingle = true)
            assertEquals(
                "sunrise",
                graph.directory.current
                    .filterNotNull()
                    .first()
                    .slug,
            )
        }

    @Test
    fun a_failed_open_stays_on_the_list_with_an_error() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
            backend.on("$SUNRISE/api/v1/session", { apiError(HttpStatusCode.NotFound, "not_found") })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            val holder = graph.clinicPicker(this, autoOpenSingle = true)
            holder.state.first { it is ClinicPickerState.Choose }
            holder.select("sunrise")
            val state =
                holder.state.first {
                    it is ClinicPickerState.Choose && it.error != null
                } as ClinicPickerState.Choose
            assertEquals(ScreenError.NotFound, state.error)
            assertNull(state.opening)
            assertNull(graph.directory.current.value)
        }

    @Test
    fun no_clinics_and_server_errors_have_their_own_states() =
        runTest {
            val backend = FakeBackend()
            backend.on("$DEMO_APP/api/v1/me", {
                apiError(HttpStatusCode.NotImplemented, "internal")
            }, { json("""{"clinics":[],"console_access":false}""") })
            val graph = testGraph(backend, backgroundScope)
            signIn(graph, backend)
            // 501: a server error the client does not retry, so one answer is one attempt.
            val holder = graph.clinicPicker(this, autoOpenSingle = true)
            assertEquals(
                ClinicPickerState.Failed(ScreenError.Server),
                holder.state.first { it is ClinicPickerState.Failed },
            )
            holder.retry()
            assertEquals(ClinicPickerState.Empty, holder.state.first { it == ClinicPickerState.Empty })
        }

    @Test
    fun prod_without_an_app_host_reports_not_configured() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope, AppEnvironment.Prod)
            val holder = graph.clinicPicker(this, autoOpenSingle = true)
            assertEquals(
                ClinicPickerState.Failed(ScreenError.NotConfigured),
                holder.state.first { it is ClinicPickerState.Failed },
            )
            assertTrue(backend.requests.isEmpty())
        }
}
