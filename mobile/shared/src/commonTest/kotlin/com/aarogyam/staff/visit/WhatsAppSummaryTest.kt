package com.aarogyam.staff.visit

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import com.sakalya.mobile.core.LogLevel
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant

class WhatsAppSummaryTest {
    private val route = "$SUNRISE/api/v1/visits/v1/patient-message"
    private val both = listOf("clinical.read", "patients.contact")

    // 17:42 in Kolkata.
    private val clock = Instant.parse("2026-11-19T12:12:00Z")

    private fun message(
        recipient: String = "patient",
        autoSentAt: String? = null,
    ) = """{"phone_e164":"+919876543210","text":"*Sunrise Dental*\nMeera, today: filling & care","short_text":"Hello",
        "url":"https://sunrise.example/shared/t1","pin":"123456","expires_at":"2026-11-26T12:12:00Z",
        "recipient":"$recipient"${autoSentAt?.let { ""","auto_sent_at":"$it"""" } ?: ""}}"""

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = both,
        logs: MemoryLogSink = MemoryLogSink(),
    ): WhatsAppSummaryStateHolder {
        val graph = testGraph(backend, backgroundScope, logs = logs)
        val clinic = openClinic(backend, graph, this, permissions)
        return WhatsAppSummaryStateHolder(
            clinic,
            "v1",
            backgroundScope,
            Logger("aarogyam.whatsapp", logs, LogLevel.Debug),
            now = { clock },
        )
    }

    @Test
    fun prepares_the_message_for_whatsapp_and_logs_no_text() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(message()) })
            val logs = MemoryLogSink()
            val holder = holder(backend, logs = logs)
            val handoff = holder.prepareNow()
            val request = backend.requests.last { it.url.encodedPath == "/api/v1/visits/v1/patient-message" }
            assertEquals(HttpMethod.Post, request.method)
            assertEquals("919876543210", handoff?.phoneDigits)
            assertEquals(
                "https://wa.me/919876543210?text=%2ASunrise%20Dental%2A%0AMeera%2C%20today%3A%20filling%20%26%20care",
                handoff?.waMeLink,
            )
            assertTrue(handoff?.appLink.orEmpty().startsWith("whatsapp://send?phone=919876543210&text=%2ASunrise"))
            val prepared = assertIs<WhatsAppSummaryState.Prepared>(holder.state.value)
            assertEquals(17 * 60 + 42, prepared.preparedMinute)
            assertFalse(prepared.forGuardian)
            assertNull(prepared.autoSentMinute)
            assertEquals("WhatsAppHandoff(redacted)", handoff.toString())
            assertTrue(logs.records.any { it.event == "visit.summary_prepared" })
            val logged = logs.records.toString()
            assertFalse(logged.contains("Meera") || logged.contains("9876543210") || logged.contains("123456"))
        }

    @Test
    fun a_guardian_and_an_automatic_summary_are_told_apart() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(message("guardian", autoSentAt = "2026-11-19T11:30:00Z")) })
            val holder = holder(backend)
            holder.prepareNow()
            val prepared = assertIs<WhatsAppSummaryState.Prepared>(holder.state.value)
            assertTrue(prepared.forGuardian)
            assertEquals(17 * 60, prepared.autoSentMinute)
        }

    @Test
    fun each_refusal_has_its_reason_and_other_failures_stay_errors() =
        runTest {
            val cases =
                mapOf(
                    "visit_open" to SummaryRefusal.VisitOpen,
                    "no_phone" to SummaryRefusal.NoPhone,
                    "no_consent" to SummaryRefusal.NoConsent,
                    "opted_out" to SummaryRefusal.OptedOut,
                )
            for ((code, reason) in cases) {
                val backend = FakeBackend()
                backend.on(route, { apiError(HttpStatusCode.Conflict, code) })
                val holder = holder(backend)
                assertNull(holder.prepareNow())
                assertEquals(WhatsAppSummaryState.Refused(reason), holder.state.value)
            }
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.NotFound, "not_found") })
            val holder = holder(backend)
            assertNull(holder.prepareNow())
            assertEquals(WhatsAppSummaryState.Failed(ScreenError.NotFound), holder.state.value)
        }

    @Test
    fun hidden_without_both_keys_and_asks_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(message()) })
            val holder = holder(backend, permissions = listOf("clinical.read"))
            assertFalse(holder.visible)
            assertNull(holder.prepareNow())
            assertTrue(backend.requests.none { it.url.encodedPath.endsWith("/patient-message") })
            assertFalse(canSendSummary(setOf("patients.contact")))
            assertTrue(canSendSummary(both.toSet()))
        }

    @Test
    fun no_whatsapp_is_said_plainly() =
        runTest {
            val holder = holder(FakeBackend())
            holder.whatsAppMissing()
            assertEquals(WhatsAppSummaryState.Refused(SummaryRefusal.NoWhatsApp), holder.state.value)
        }
}
