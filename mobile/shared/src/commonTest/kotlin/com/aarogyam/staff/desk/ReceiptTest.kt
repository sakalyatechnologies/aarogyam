package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ReceiptTest {
    private val route = "$SUNRISE/api/v1/messages"
    private val receipt =
        Receipt(
            paymentId = "pay1",
            patientId = "p1",
            number = "RC-0042",
            amountPaise = 125050,
            method = "cash",
            receivedOn = "2026-11-26",
            invoiceNumber = "INV-7",
            clinicName = "Sunrise Dental",
        )

    @Test
    fun the_text_names_the_receipt_clinic_amount_and_bill_but_not_the_patient() {
        assertEquals("Receipt RC-0042 from Sunrise Dental: ₹1250.5 received for bill INV-7.", receipt.shareText())
        assertEquals(
            "Receipt RC-0042 from Sunrise Dental: ₹1250.5 received.",
            receipt.copy(invoiceNumber = null).shareText(),
        )
    }

    @Test
    fun the_email_body_is_a_care_note_with_a_subject() {
        val request = receipt.emailRequest("b1")
        assertEquals(listOf("p1"), request.patientIds)
        assertEquals("email", request.channel)
        assertEquals("care.note", request.templateKey)
        assertEquals("b1", request.batchId)
        assertEquals(receipt.shareText(), request.body)
        assertEquals(mapOf("subject" to "Your receipt RC-0042"), request.variables)
    }

    @Test
    fun without_messages_send_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val holder = ReceiptEmailHolder(openClinic(backend, graph, this, listOf("billing.read")), backgroundScope)
            assertFalse(holder.canEmail)
            holder.send(receipt)
            assertEquals(0, backend.count(route))
        }

    @Test
    fun a_patient_with_no_email_gets_the_message_and_each_tap_has_its_own_batch() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                {
                    json(
                        """{"batch_id":"b","requested":1,"queued":0,"already_queued":0,"no_address":1,"no_consent":0}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            var n = 0
            val holder =
                ReceiptEmailHolder(
                    openClinic(backend, graph, this, listOf("messages.send")),
                    backgroundScope,
                    newBatch = { "batch-${++n}" },
                )
            assertTrue(holder.canEmail)
            holder.send(receipt)
            assertIs<ReceiptEmail.NoEmail>(
                holder.state.first { it !is ReceiptEmail.Idle && it !is ReceiptEmail.Sending },
            )
            holder.send(receipt)
            holder.state.first { it is ReceiptEmail.NoEmail }
            assertEquals(2, n)
        }

    @Test
    fun the_answer_maps_to_what_the_desk_reads() {
        fun answer(
            queued: Long,
            noConsent: Long = 0,
            noAddress: Long = 0,
        ) = com.aarogyam.staff.api.model
            .MessagesQueued(
                batchId = "b",
                requested = 1,
                queued = queued,
                alreadyQueued = 0,
                noConsent = noConsent,
                noAddress = noAddress,
            ).toReceiptEmail()
        assertEquals(ReceiptEmail.Queued, answer(1))
        assertEquals(ReceiptEmail.NoConsent, answer(0, noConsent = 1))
        assertEquals(ReceiptEmail.NoEmail, answer(0, noAddress = 1))
        assertEquals(ReceiptEmail.AlreadySent, answer(0))
    }
}
