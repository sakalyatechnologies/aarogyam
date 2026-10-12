package com.aarogyam.staff.labs

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LabsTest {
    private fun order(
        status: String = "sent",
        due: String = "2026-10-12",
        contacted: String? = null,
    ) = """{"id":"o1","number":"LAB-12","vendor_id":"v1","vendor_name":"Precision Dental Lab","contact_whatsapp":true,
           "contact_name":"Ravi","contact_phone":"+919820000001","vendor_phone":"+912000000000",
           "patient_id":"p1","patient_number":"SD-1042","patient_name":"Meera Shah","doctor_id":"m1","status":"$status","late":false,"pipeline_stage":"sent",
           "created_at":"2026-10-01T04:00:00Z","costs_visible":false,"due_on":"$due","last_contacted_at":${contacted?.let {
        "\"$it\""
    } ?: "null"},
           "items":[{"id":"i2","line_no":2,"work_type":"Crown","teeth":[36],"qty":1},{"id":"i1","line_no":1,"work_type":"Post","teeth":[36,35],"qty":1}],
           "events":[]}"""

    private val labs =
        """{"items":[{"id":"v1","name":"Precision Dental Lab","kind":"dental_lab","phone":"+912000000000","created_at":"x",
           "contacts":[{"id":"c1","vendor_id":"v1","name":"Ravi","phone":"+919820000001","whatsapp":true,"preferred_channel":"whatsapp"}]}]}"""

    @Test
    fun cases_and_the_directory_load_together() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/lab-orders", { json("""{"items":[${order()}]}""") })
            backend.on("$SUNRISE/api/v1/lab-vendors", { json(labs) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("labs.read"))
            val s = LabsStateHolder(clinic, this).state.first { it.cases.isNotEmpty() && it.labs.isNotEmpty() }
            val case = s.cases.single()
            assertEquals(listOf("Post", "Crown"), case.work)
            assertEquals(listOf(35, 36), case.teeth)
            assertEquals("+919820000001", case.phone)
            assertTrue(case.status.open)
            assertEquals(
                "Ravi",
                s.labs
                    .single()
                    .contacts
                    .single()
                    .name,
            )
            assertFalse(s.canWrite)
        }

    @Test
    fun logging_a_promised_date_updates_the_case() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/lab-orders", { json("""{"items":[${order()}]}""") })
            backend.on("$SUNRISE/api/v1/lab-vendors", { json(labs) })
            backend.on("$SUNRISE/api/v1/lab-orders/o1/contacts-log", {
                json(order(due = "2026-10-15", contacted = "2026-10-09T05:00:00Z"), HttpStatusCode.Created)
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("labs.read", "labs.write"))
            val holder = LabsStateHolder(clinic, this)
            holder.state.first { it.cases.isNotEmpty() }
            holder.logContact(
                "o1",
                ContactChannel.Call,
                ContactOutcome.PromisedDate,
                "Will ship Thursday",
                "2026-10-15",
            )
            val case =
                holder.state
                    .first { it.cases.single().dueOn == "2026-10-15" }
                    .cases
                    .single()
            assertEquals("2026-10-09T05:00:00Z", case.lastContactedAt)
            val body = (backend.requests.last { it.url.encodedPath.endsWith("contacts-log") }.body as TextContent).text
            assertTrue(
                """"channel":"call"""" in body && """"outcome":"promised_date"""" in body &&
                    """"promised_on":"2026-10-15"""" in body,
                body,
            )
        }

    @Test
    fun a_new_case_sends_its_work_and_visit() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/lab-orders", { json(order(status = "sent"), HttpStatusCode.Created) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("labs.read", "labs.write"))
            val holder = NewLabCaseStateHolder(clinic, "p1", "v9", this)
            assertFalse(holder.state.value.canSave)
            holder.chooseLab("v1", "c1")
            holder.addWork(LabWork("Crown", listOf(36, 36), shade = "A2", material = "zirconia"))
            holder.setInstructions("  Match 37  ")
            holder.save(send = true)
            assertEquals("LAB-12", holder.state.first { it.created != null }.created)
            val body =
                (
                    backend.requests
                        .last {
                            it.method.value == "POST" && it.url.encodedPath == "/api/v1/lab-orders"
                        }.body as TextContent
                ).text
            assertTrue(
                """"teeth":[36]""" in body && """"shade":"A2"""" in body && """"encounter_id":"v9"""" in body,
                body,
            )
            assertTrue(""""send":true""" in body && """"instructions":"Match 37"""" in body, body)
            assertFalse("Meera" in body)
        }
}
