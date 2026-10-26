package com.aarogyam.staff.config.caps

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.family
import com.aarogyam.staff.api.lookupByPhone
import com.aarogyam.staff.api.model.NewPayment
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.walkin.LOOKUP
import com.aarogyam.staff.walkin.MATCHES_JSON
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Outcome
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ServerCapsTest {
    private val payment =
        """{"id":"pay1","number":"RC/1","patient":{"id":"p1","number":"SD-1042","name":"Meera Shah"},
          "received_at":"2026-10-08T04:00:00Z","amount_paise":50000,"method":"cash","status":"received",
          "allocated_paise":0,"unallocated_paise":50000,"allocations":[]"""

    @Test
    fun every_flag_is_off_against_main_shaped_answers() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            // The lookup as main's spec has it (`items` only) and a payment without `attachment_id`.
            backend.on(LOOKUP, { json(MATCHES_JSON.replace(""","family_group":[]""", "")) })
            backend.on("$SUNRISE/api/v1/payments", { json("$payment}", HttpStatusCode.Created) })
            val clinic =
                openClinic(backend, testGraph(backend, backgroundScope), this, listOf("billing.write", "patients.read"))
            assertIs<Outcome.Success<*>>(clinic.api.lookupByPhone("+919876543210"))
            val paid =
                clinic.api.recordPayment(
                    NewPayment(patientId = "p1", method = "cash", amountPaise = 50000),
                    IdempotencyKey.generate(),
                )
            assertIs<Outcome.Success<*>>(paid)
            assertEquals(CapsSnapshot(), ServerCaps.state.value)
            assertTrue(!ServerCaps.family && !ServerCaps.paymentProof && !ServerCaps.notificationAudience)
            assertTrue(!ServerCaps.walkInReason && !ServerCaps.queueRemind && !ServerCaps.messageStatus)
        }

    @Test
    fun family_and_proof_turn_on_only_when_their_field_appears() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            backend.on(
                "$SUNRISE/api/v1/payments",
                { json("""$payment,"attachment_id":null}""", HttpStatusCode.Created) },
            )
            val clinic =
                openClinic(backend, testGraph(backend, backgroundScope), this, listOf("billing.write", "patients.read"))
            clinic.api.lookupByPhone("+919876543210")
            assertTrue(ServerCaps.family && !ServerCaps.paymentProof)
            clinic.api.recordPayment(
                NewPayment(patientId = "p1", method = "cash", amountPaise = 50000),
                IdempotencyKey.generate(),
            )
            assertTrue(ServerCaps.paymentProof)
            ServerCaps.reset()
        }

    @Test
    fun family_calls_answer_not_supported_while_the_flag_is_off_and_send_nothing() =
        runTest {
            ServerCaps.reset()
            val backend = FakeBackend()
            val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, listOf("patients.read"))
            val answer = clinic.api.family("p1")
            assertEquals(NOT_SUPPORTED, assertIs<Outcome.Failure<com.sakalya.mobile.core.ApiError>>(answer).error.code)
            assertEquals(0, backend.count("$SUNRISE/api/v1/patients/p1/family"))
        }

    @Test
    fun the_hand_written_family_dtos_ignore_keys_they_do_not_know() {
        val list =
            capsJson.decodeFromString(
                FamilyList.serializer(),
                """{"items":[{"id":"l1","patient_id":"p5","number":"SD-1","full_name":"Tara","relation":"child","is_primary_contact":true,"extra":1}]}""",
            )
        assertEquals("Tara", list.items.single().fullName)
    }
}
