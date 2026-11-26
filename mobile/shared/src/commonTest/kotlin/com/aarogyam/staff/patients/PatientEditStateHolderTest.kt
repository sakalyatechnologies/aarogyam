package com.aarogyam.staff.patients

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patientJson
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.AddressField
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PatientEditStateHolderTest {
    private val path = "$SUNRISE/api/v1/patients/p1"
    private val view =
        PatientView(
            id = "p1",
            name = "Meera Shah",
            number = "SD-1042",
            ageYears = 34,
            sex = Sex.Female,
            phone = "+919876543210",
            language = "en-IN",
            recallDue = false,
            flags = FlagsView(0, false, 0, false, emptyList(), emptyList()),
            upcoming = emptyList(),
            visits = null,
            balancePaise = null,
            rowVersion = 3,
        )

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "patients.write", "patients.contact"),
    ): PatientEditStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.patientEdit(openClinic(backend, graph, this, permissions), view, backgroundScope)
    }

    @Test
    fun saving_sends_the_edit_guarded_by_the_row_version() =
        runTest {
            val backend = FakeBackend()
            backend.on(path, { json(patientJson("p1", "Meera S")) })
            val h = holder(backend)
            h.setName("Meera S")
            h.setAddress(AddressField.Line1, "12 MG Road")
            h.save()
            assertTrue(h.state.first { it.saved }.saved)
            val sent = backend.requests.single { it.url.encodedPath.endsWith("/patients/p1") }
            assertEquals("\"3\"", sent.headers["If-Match"])
            val body = sent.body.toByteArray().decodeToString()
            assertTrue("\"full_name\":\"Meera S\"" in body, body)
            assertTrue("12 MG Road" in body, body)
            assertTrue("phone" !in body, body)
        }

    @Test
    fun an_empty_name_is_refused_without_a_request() =
        runTest {
            val backend = FakeBackend()
            val h = holder(backend)
            h.setName(" ")
            h.save()
            assertEquals(PatientEditProblem.NameRequired, h.state.value.problem)
            assertEquals(0, backend.count(path))
        }

    @Test
    fun a_stale_record_says_it_changed() =
        runTest {
            val backend = FakeBackend()
            backend.on(path, { apiError(HttpStatusCode.PreconditionFailed, "stale_version") })
            val h = holder(backend)
            h.save()
            assertEquals(PatientEditProblem.Changed, h.state.first { !it.saving && it.problem != null }.problem)
        }

    @Test
    fun the_phone_is_locked_without_contact_permission() =
        runTest {
            val h = holder(FakeBackend(), listOf("patients.read", "patients.write"))
            assertEquals(false, h.state.value.canEditPhone)
            assertEquals("", h.state.value.phone)
        }
}
