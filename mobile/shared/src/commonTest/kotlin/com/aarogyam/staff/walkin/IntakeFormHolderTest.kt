package com.aarogyam.staff.walkin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.outbox.ManualConnectivity
import com.aarogyam.staff.outbox.MemoryOutboxFiles
import com.aarogyam.staff.outbox.MemoryOutboxStore
import com.aarogyam.staff.outbox.OutboxEntry
import com.aarogyam.staff.outbox.OutboxKind
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.PatientFileJob
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.outbox.queueJson
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.serialization.decodeFromString
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val NOTICES = "$SUNRISE/api/v1/consent-notices"
private val TODAY = LocalDate(2026, 10, 12)

class IntakeFormHolderTest {
    private val store = MemoryOutboxStore()
    private val files = MemoryOutboxFiles()
    private val net = ManualConnectivity(online = false)
    private val sender = OutboxSender { SendResult.Delivered }
    private var online = true

    @BeforeTest
    fun before() = ServerCaps.reset()

    @AfterTest
    fun after() = ServerCaps.reset()

    private suspend fun TestScope.holder(backend: FakeBackend): IntakeFormHolder {
        backend.on(DOCTORS, { json(DOCTORS_JSON) })
        backend.on(PICKS, { json(PICKS_JSON) })
        backend.on(
            NOTICES,
            {
                json(
                    """{"items":[{"id":"n7","version":3,"label":"v3 2026-10","body":"We keep your record.",
                    "published_at":"2026-10-01T00:00:00Z"}]}""",
                )
            },
        )
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, DESK)
        val runner = OutboxRunner(store, sender, net, { 1_000L })
        val holder =
            IntakeFormStateHolder(clinic, backgroundScope, online = {
                online
            }, runner = { runner }, files = { files }, today = { TODAY })
        holder.state.first { it.notice != null }
        return holder
    }

    private fun IntakeFormHolder.fillValid() {
        setName("Ravi Kulkarni")
        setPhone("9876543210")
        setAge("40")
        setSex(Sex.Male)
        setEmail("ravi@example.com")
        toggleNoKnownAllergies()
        setReadAloud(true)
        setSignature(byteArrayOf(1, 2, 3))
        setPhoto(byteArrayOf(9, 9))
    }

    private suspend fun FakeBackend.walkInBody(): String =
        requests
            .last { it.url.encodedPath.endsWith("walk-ins") }
            .body
            .toByteArray()
            .decodeToString()

    @Test
    fun validation_marks_each_field_inline() =
        runTest {
            val holder = holder(FakeBackend())
            holder.setPhone("98765")
            holder.setEmail("nope")
            holder.saveAndQueue()
            val errors = holder.state.value.errors
            assertEquals(IntakeProblem.Required, errors[IntakeField.Name])
            assertEquals(IntakeProblem.Invalid, errors[IntakeField.Phone])
            assertEquals(IntakeProblem.Invalid, errors[IntakeField.Email])
            assertEquals(IntakeProblem.Required, errors[IntakeField.Birth], "date of birth or age")
            assertEquals(IntakeProblem.Required, errors[IntakeField.Allergies])
            assertEquals(IntakeProblem.Required, errors[IntakeField.Consent])
            assertEquals(IntakeProblem.Required, errors[IntakeField.Signature])
            holder.toggleAllergy("Latex")
            assertNull(holder.state.value.errors[IntakeField.Allergies], "an error clears when the field is fixed")
        }

    @Test
    fun date_of_birth_or_age_either_is_enough_and_a_future_date_is_not() {
        val base = IntakeForm(name = "Ravi", noKnownAllergies = true, readAloud = true, signaturePresent = true)
        assertTrue(validate(base.copy(age = "40"), TODAY).isEmpty())
        assertTrue(validate(base.copy(dateOfBirth = "1986-03-02"), TODAY).isEmpty())
        assertEquals(IntakeProblem.InFuture, validate(base.copy(dateOfBirth = "2027-01-01"), TODAY)[IntakeField.Birth])
        assertEquals(IntakeProblem.Invalid, validate(base.copy(dateOfBirth = "1986-13-45"), TODAY)[IntakeField.Birth])
        assertEquals(IntakeProblem.Invalid, validate(base.copy(age = "150"), TODAY)[IntakeField.Birth])
    }

    @Test
    fun an_online_save_makes_one_walk_in_request_then_two_file_entries() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.setPractitioner("d1")
            holder.saveAndQueue()
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertEquals(1, backend.count(WALK_INS))
            val done = assertNotNull(holder.state.value.done)
            assertEquals(IntakeDone("p9", "t1", 7, filesQueued = 2), done)
            val body = backend.walkInBody()
            assertTrue(""""phone":"+919876543210"""" in body && """"email":"ravi@example.com"""" in body)
            assertTrue(""""notice_id":"n7"""" in body)
            assertTrue(""""practitioner_id":"d1"""" in body && """"no_known_allergies":true""" in body)
            val entries = store.all().sortedBy { it.createdAt }
            assertEquals(2, entries.size)
            assertTrue(entries.all { it.kind == OutboxKind.PatientFile && it.fileName != null })
            val jobs =
                entries.associate {
                    queueJson.decodeFromString<PatientFileJob>(it.payload).label to
                        queueJson.decodeFromString<PatientFileJob>(it.payload)
                }
            assertEquals("photo", jobs["Profile"]?.kind)
            assertEquals("consent", jobs["Signature"]?.kind)
            assertTrue(jobs.values.all { it.patientId == "p9" })
            assertEquals(2, files.names.size)
        }

    @Test
    fun offline_saves_nothing_and_keeps_the_form() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            online = false
            holder.saveAndQueue()
            assertEquals(IntakeSubmitError.NeedsConnection, holder.state.value.submitError)
            assertEquals(0, backend.count(WALK_INS))
            assertTrue(store.all().isEmpty() && files.names.isEmpty())
            assertEquals("Ravi Kulkarni", holder.state.value.name)
            assertTrue(holder.state.value.signaturePresent)
            online = true
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertEquals(2, store.all().size)
        }

    @Test
    fun a_server_failure_queues_no_files() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                WALK_INS,
                { json("""{"error":{"code":"validation_failed"}}""", HttpStatusCode.UnprocessableEntity) },
            )
            val holder = holder(backend)
            holder.fillValid()
            holder.saveAndQueue()
            holder.state.first { it.submitError != null }
            assertTrue(store.all().isEmpty() && files.names.isEmpty())
        }

    @Test
    fun the_reason_and_family_fields_follow_their_flags() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            assertTrue(holder.state.value.showReason, "G6 is in the spec: the reason field is on")
            assertFalse(holder.state.value.showFamily)
            holder.fillValid()
            holder.setReason("  Toothache  ")
            holder.setFamilyOf("p1", "child")
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            val body = backend.walkInBody()
            assertTrue(""""reason":"Toothache"""" in body)
            assertFalse("family_of" in body, "family is off: not sent")
        }

    @Test
    fun family_of_is_sent_when_the_family_flag_is_on() =
        runTest {
            ServerCaps.markFamily()
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            assertTrue(holder.state.value.showFamily)
            holder.fillValid()
            holder.setFamilyOf("p1", "child")
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertTrue(""""family_of":{"patient_id":"p1","relation":"child"}""" in backend.walkInBody())
        }

    @Test
    fun the_reason_is_omitted_when_its_flag_is_off() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.setReason("Toothache")
            ServerCaps.reset()
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertFalse(holder.state.value.showReason)
            assertFalse("reason" in backend.walkInBody())
        }
}
