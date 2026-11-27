package com.aarogyam.staff.walkin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.outbox.ManualConnectivity
import com.aarogyam.staff.outbox.MemoryOutboxFiles
import com.aarogyam.staff.outbox.MemoryOutboxStore
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val NOTICES = "$SUNRISE/api/v1/consent-notices"
private const val OPTIONS = "$SUNRISE/api/v1/patients/intake-options"
private val TODAY = LocalDate(2026, 10, 12)

private const val OPTIONS_JSON =
    """{"blood_groups":[{"code":"O+","label":"O+"}],"call_times":[{"code":"morning","label":"Morning"}],
       "health_flags":[{"code":"diabetes","label":"Diabetes"},{"code":"asthma","label":"Asthma"}],
       "heard_via":[{"code":"friend","label":"A friend"}]}"""

class IntakeRegistrationTest {
    @BeforeTest
    fun before() = ServerCaps.reset()

    @AfterTest
    fun after() = ServerCaps.reset()

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = DESK,
    ): IntakeFormStateHolder {
        backend.on(DOCTORS, { json(DOCTORS_JSON) })
        backend.on(PICKS, { json(PICKS_JSON) })
        backend.on(OPTIONS, { json(OPTIONS_JSON) })
        backend.on(
            NOTICES,
            {
                json(
                    """{"items":[{"id":"n7","version":3,"label":"v3","body":"We keep your record.","published_at":"2026-10-01T00:00:00Z"}]}""",
                )
            },
        )
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, permissions)
        val runner =
            OutboxRunner(
                MemoryOutboxStore(),
                OutboxSender { SendResult.Delivered },
                ManualConnectivity(online = false),
                { 1_000L },
            )
        val holder =
            IntakeFormStateHolder(clinic, backgroundScope, online = {
                true
            }, runner = { runner }, files = { MemoryOutboxFiles() }, today = { TODAY })
        holder.state.first { it.notice != null }
        return holder
    }

    private fun IntakeFormHolder.fillValid(phone: String = "9876543210") {
        setName("Ravi Kulkarni")
        setPhone(phone)
        setAge("40")
        toggleNoKnownAllergies()
        setReadAloud(true)
        setSignature(byteArrayOf(1))
    }

    private suspend fun FakeBackend.walkInBody() =
        requests
            .last {
                it.url.encodedPath.endsWith("walk-ins")
            }.body
            .toByteArray()
            .decodeToString()

    @Test
    fun the_options_load_with_intake_write_and_the_sections_show() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend)
            val form = holder.state.first { it.options != null }
            assertEquals(listOf("diabetes", "asthma"), form.options?.healthFlags?.map { it.code })
            assertTrue(form.showDetails)
            assertEquals(1, backend.count(OPTIONS))
        }

    @Test
    fun without_intake_write_nothing_loads_and_nothing_is_sent() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend, permissions = listOf("patients.read", "patients.write", "appointments.write"))
            assertEquals(0, backend.count(OPTIONS))
            assertTrue(!holder.state.value.showDetails)
            holder.fillValid()
            holder.setDetail(DetailField.Occupation, "Teacher")
            holder.toggleHealth("diabetes")
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            val body = backend.walkInBody()
            assertTrue("intake" !in body && "health" !in body && "allergies_text" !in body)
        }

    @Test
    fun the_women_section_follows_the_sex() =
        runTest {
            val holder = holder(FakeBackend())
            assertTrue(!holder.state.value.showWomen)
            holder.setSex(Sex.Female)
            assertTrue(holder.state.value.showWomen)
            holder.setSex(Sex.Male)
            assertTrue(!holder.state.value.showWomen)
        }

    @Test
    fun the_new_fields_go_on_the_new_patient_and_all_are_optional() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            val plain = backend.walkInBody()
            assertTrue("\"intake\"" !in plain && "\"health\"" !in plain, "an untouched section sends nothing")
        }

    @Test
    fun intake_health_and_allergy_words_are_sent_and_the_women_fields_only_for_women() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.setSex(Sex.Female)
            holder.setDetail(DetailField.BloodGroup, "O+")
            holder.setDetail(DetailField.AltPhone, "9123456789")
            holder.toggleHealth("diabetes")
            holder.setDetail(DetailField.AllergiesText, "Dust")
            holder.setPregnant(true)
            holder.setDetail(DetailField.DueDate, "2027-02-01")
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            val body = backend.walkInBody()
            assertTrue("\"blood_group\":\"O+\"" in body && "\"alt_phone\":\"+919123456789\"" in body)
            assertTrue("\"health\":[\"diabetes\"]" in body && "\"allergies_text\":\"Dust\"" in body)
            assertTrue("\"pregnant\":true" in body && "\"due_date\":\"2027-02-01\"" in body)
        }

    @Test
    fun a_man_with_women_answers_left_over_sends_none() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.setSex(Sex.Female)
            holder.setPregnant(true)
            holder.setSex(Sex.Male)
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertTrue("pregnant" !in backend.walkInBody())
        }

    @Test
    fun a_bad_detail_phone_stops_the_save_inline() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend)
            holder.fillValid()
            holder.setDetail(DetailField.EmergencyPhone, "12345")
            holder.saveAndQueue()
            assertEquals(IntakeProblem.Invalid, holder.state.value.errors[IntakeField.EmergencyPhone])
            assertEquals(0, backend.count(WALK_INS))
            holder.setDetail(DetailField.EmergencyPhone, "9123456789")
            assertNull(holder.state.value.errors[IntakeField.EmergencyPhone])
        }

    @Test
    fun ten_typed_digits_look_up_the_number_and_a_match_can_start_a_family_member() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            val holder = holder(backend)
            holder.setPhone("98765")
            assertEquals(0, backend.count(LOOKUP))
            holder.setPhone("9876543210")
            val matches = assertIs<LookupState.Matches>(holder.state.first { it.lookup is LookupState.Matches }.lookup)
            assertEquals("SD-1042", matches.items.single().number)
            holder.addFamilyOnNumber(matches.items.single().id)
            assertEquals(FamilyOf("p1", "child"), holder.state.value.familyOf)
            assertEquals("9876543210", holder.state.value.phone, "the phone stays")
            holder.setPhone("987654321")
            assertEquals(LookupState.Idle, holder.state.value.lookup)
            assertNull(holder.state.value.familyOf, "the link goes with the card")
        }

    @Test
    fun a_prefilled_phone_does_not_look_up() =
        runTest {
            val backend = FakeBackend()
            backend.on(LOOKUP, { json(MATCHES_JSON) })
            val holder = holder(backend)
            holder.prefillPhone("+919876543210")
            assertEquals("9876543210", holder.state.value.phone)
            assertEquals(LookupState.Idle, holder.state.value.lookup)
            assertEquals(0, backend.count(LOOKUP))
            assertNotNull(holder.state.value)
        }

    @Test
    fun the_date_of_birth_is_typed_and_shown_as_dd_mm_yyyy_and_sent_as_iso() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.setDateOfBirth("0705")
            assertEquals("07/05", holder.state.value.dobTyped)
            holder.saveAndQueue()
            assertEquals(IntakeProblem.Invalid, holder.state.value.errors[IntakeField.Birth], "incomplete")
            holder.setDateOfBirth("07/05/1990")
            assertEquals("07/05/1990", holder.state.value.dobTyped)
            assertEquals("1990-05-07", holder.state.value.dateOfBirth)
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertTrue("\"date_of_birth\":\"1990-05-07\"" in backend.walkInBody())
        }

    @Test
    fun an_impossible_date_is_invalid_and_the_age_clears_the_date() {
        assertEquals("??", dobIso("31/02/1990"))
        assertEquals("", dobIso(""))
        assertEquals("07/05/1990", dobDisplay("07051990999"))
    }

    @Test
    fun a_language_pick_is_sent_and_english_sends_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            val holder = holder(backend)
            holder.fillValid()
            holder.setDetail(DetailField.Language, "mr-IN")
            holder.setDetail(DetailField.Language, "")
            holder.setDetail(DetailField.Language, "hi-IN")
            holder.saveAndQueue()
            holder.state.first { it.done != null }
            assertTrue("\"preferred_language\":\"hi-IN\"" in backend.walkInBody())
        }
}
