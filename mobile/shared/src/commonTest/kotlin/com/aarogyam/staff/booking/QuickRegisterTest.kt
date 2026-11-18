package com.aarogyam.staff.booking

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.patientJson
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QuickRegisterTest {
    private val route = "$SUNRISE/api/v1/patients"

    @Test
    fun the_search_text_becomes_the_name_and_the_patient_is_made_once() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(patientJson("p-new", "Sana Shaikh"), HttpStatusCode.Created) })
            val graph = testGraph(backend, backgroundScope)
            val holder =
                graph.quickRegister(
                    openClinic(backend, graph, this, listOf("patients.write")),
                    backgroundScope,
                )
            holder.start("  Sana Shaikh ")
            assertEquals("Sana Shaikh", holder.state.value.name)
            holder.setMobile("98765")
            assertEquals(RegisterProblem.MobileInvalid, holder.problem())
            holder.setMobile("+91 98765 43210")
            holder.setEmail("sana@")
            assertEquals(RegisterProblem.EmailInvalid, holder.problem())
            holder.setEmail("sana@example.test")
            holder.setAge("140")
            assertEquals(RegisterProblem.AgeInvalid, holder.problem())
            holder.setAge("34")
            holder.setSex(Sex.Female)
            holder.setLanguage(PatientLanguage.Marathi)
            assertNull(holder.problem())
            holder.register()
            assertEquals("p-new", holder.state.first { it.createdId != null }.createdId)
            val body =
                (
                    backend.requests
                        .single {
                            it.method == HttpMethod.Post &&
                                it.url.encodedPath == "/api/v1/patients"
                        }.body as TextContent
                ).text
            assertTrue(""""full_name":"Sana Shaikh"""" in body && """"phone":"+919876543210"""" in body, body)
            assertTrue(
                """"age_years":34""" in body && """"sex":"female"""" in body &&
                    """"preferred_language":"mr-IN"""" in body,
                body,
            )
            holder.register()
            holder.start("Someone else")
            assertEquals("Sana Shaikh", holder.state.value.name, "the made patient stays picked")
            assertEquals(
                1,
                backend.requests.count {
                    it.method == HttpMethod.Post &&
                        it.url.encodedPath == "/api/v1/patients"
                },
                "never registered twice",
            )
        }

    @Test
    fun a_refusal_keeps_the_form_and_without_patients_write_nothing_is_sent() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.BadRequest, "invalid_request") })
            val graph = testGraph(backend, backgroundScope)
            val holder =
                graph.quickRegister(
                    openClinic(backend, graph, this, listOf("patients.write")),
                    backgroundScope,
                )
            holder.start("Ravi")
            holder.register()
            assertNotNull(holder.state.first { it.error != null }.error)
            assertEquals("Ravi", holder.state.value.name)
            assertNull(holder.state.value.createdId)

            val other = FakeBackend()
            val readOnly = testGraph(other, backgroundScope)
            val blocked =
                readOnly.quickRegister(
                    openClinic(other, readOnly, this, listOf("patients.read")),
                    backgroundScope,
                )
            blocked.start("Ravi")
            blocked.register()
            assertEquals(0, other.requests.count { it.url.encodedPath == "/api/v1/patients" })
        }
}
