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
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LabsV11Test {
    private fun order(
        id: String = "o1",
        status: String = "sent",
        tracker: String? = "trial",
    ) = """{"id":"$id","number":"LAB-$id","vendor_id":"v1","vendor_name":"Precision Dental Lab","contact_whatsapp":true,
           "patient_id":"p1","patient_number":"SD-1042","patient_name":"Meera Shah","doctor_id":"m1","status":"$status","late":true,
           "pipeline_stage":"sent","created_at":"2026-10-01T04:00:00Z","costs_visible":false,"due_on":"2026-10-01",
           ${tracker?.let { "\"tracker_stage\":\"$it\"," } ?: ""}
           "items":[{"id":"i1","line_no":1,"work_type":"Crown","teeth":[36],"qty":1}],"events":[]}"""

    private val labs =
        """{"items":[{"id":"v1","name":"Precision Dental Lab","kind":"dental_lab","created_at":"x","contacts":[],
           "city":" Pune ","work_types":["Crown","Aligner"],"turnaround_days":5},
           {"id":"v2","name":"Plain","kind":"dental_lab","created_at":"x","contacts":[]}]}"""

    private val remindUrl = "$SUNRISE/api/v1/lab-orders/reminders"

    private suspend fun kotlinx.coroutines.test.TestScope.holder(
        backend: FakeBackend,
        perms: List<String> = listOf("labs.read", "labs.write"),
    ): LabsStateHolder {
        backend.on("$SUNRISE/api/v1/lab-vendors", { json(labs) })
        val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, perms)
        return LabsStateHolder(clinic, this)
    }

    @Test
    fun the_tracker_stage_and_vendor_fields_are_carried() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/lab-orders",
                { json("""{"items":[${order()},${order(id = "o2", status = "cancelled", tracker = null)}]}""") },
            )
            val s = holder(backend).state.first { it.cases.size == 2 && it.labs.isNotEmpty() }
            assertEquals(LabStage.Trial, s.cases[0].tracker)
            assertNull(s.cases[1].tracker)
            assertEquals("Pune", s.labs[0].city)
            assertEquals(listOf("Crown", "Aligner"), s.labs[0].workTypes)
            assertEquals(5, s.labs[0].turnaroundDays)
            assertNull(s.labs[1].city)
            assertTrue(s.labs[1].workTypes.isEmpty())
            assertNull(s.labs[1].turnaroundDays)
        }

    @Test
    fun a_reminder_exposes_its_whatsapp_link_until_opened() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/lab-orders/o1", { json(order()) })
            backend.on(
                "$SUNRISE/api/v1/lab-orders",
                { json("""{"items":[${order()}]}""") },
            )
            backend.on(
                "$SUNRISE/api/v1/lab-orders/o1/remind",
                {
                    json(
                        """{"message_id":"m1","wa_link":"https://wa.me/919820000001?text=Hi"}""",
                        HttpStatusCode.Accepted,
                    )
                },
            )
            val h = holder(backend)
            h.state.first { it.cases.isNotEmpty() }
            h.remind("o1")
            assertEquals("https://wa.me/919820000001?text=Hi", h.state.first { it.waLink != null }.waLink)
            h.waLinkOpened()
            assertNull(h.state.value.waLink)
        }

    @Test
    fun remind_all_sends_the_overdue_orders_and_reports_the_result() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/lab-orders",
                { json("""{"items":[${order()},${order(id = "o2")},${order(id = "o3", status = "received")}]}""") },
            )
            backend.on(
                remindUrl,
                {
                    json(
                        """{"channel":"whatsapp","vendors":[{"vendor_id":"v1","vendor_name":"Precision Dental Lab",
                           "order_ids":["o1","o2"],"order_numbers":["LAB-o1","LAB-o2"],"wa_link":"https://wa.me/1?text=x"}],
                           "skipped":[{"order_id":"o9","number":"LAB-9","reason":"no_phone"}]}""",
                    )
                },
            )
            val h = holder(backend)
            h.state.first { it.cases.size == 3 }
            h.remindOverdue(ReminderChannel.WhatsApp) // not on the overdue filter: ignored
            assertEquals(0, backend.count(remindUrl))
            h.showOverdue(true)
            h.state.first { it.overdueOnly && !it.loading && it.cases.isNotEmpty() }
            h.remindOverdue(ReminderChannel.WhatsApp)
            val result = h.state.first { it.reminderResult != null }.reminderResult
            assertEquals(1, result?.labs?.size)
            assertEquals("https://wa.me/1?text=x", result?.labs?.single()?.waLink)
            assertEquals(listOf(LabSkipped("LAB-9", SkipReason.NoPhone)), result?.skipped)
            val body =
                (
                    backend.requests
                        .last {
                            it.url.encodedPath.endsWith(
                                "lab-orders/reminders",
                            )
                        }.body as TextContent
                ).text
            assertTrue(""""order_ids":["o1","o2"]""" in body && """"channel":"whatsapp"""" in body, body)
            h.reminderResultSeen()
            assertNull(h.state.value.reminderResult)
        }

    @Test
    fun remind_all_needs_write_permission() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/lab-orders", { json("""{"items":[${order()}]}""") })
            val h = holder(backend, listOf("labs.read"))
            h.showOverdue(true)
            h.state.first { it.cases.isNotEmpty() }
            h.remindOverdue(ReminderChannel.Email)
            assertEquals(0, backend.count(remindUrl))
        }
}
