package com.aarogyam.staff.walkin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.outbox.ManualConnectivity
import com.aarogyam.staff.outbox.MemoryOutboxFiles
import com.aarogyam.staff.outbox.MemoryOutboxStore
import com.aarogyam.staff.outbox.OutboxRunner
import com.aarogyam.staff.outbox.OutboxSender
import com.aarogyam.staff.outbox.SendResult
import com.aarogyam.staff.patientJson
import com.aarogyam.staff.patients.Sex
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val TODAY = LocalDate(2026, 10, 12)
private const val PATIENTS = "$SUNRISE/api/v1/patients"
private const val LINKS = "$SUNRISE/api/v1/patients/p9/family"

private fun linkJson(
    id: String,
    relation: String,
) =
    """{"id":"l-$id","patient_id":"$id","number":"SD-1","full_name":"X","relation":"$relation","is_primary_contact":false}"""

class IntakeFamilyTest {
    @BeforeTest
    fun before() = ServerCaps.reset()

    @AfterTest
    fun after() = ServerCaps.reset()

    private suspend fun TestScope.holder(backend: FakeBackend): IntakeFormHolder {
        backend.on(DOCTORS, { json(DOCTORS_JSON) })
        backend.on(PICKS, { json(PICKS_JSON) })
        backend.on(
            "$SUNRISE/api/v1/consent-notices",
            {
                json(
                    """{"items":[{"id":"n7","version":3,"label":"v","body":"b","published_at":"2026-10-01T00:00:00Z"}]}""",
                )
            },
        )
        backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, DESK)
        val runner =
            OutboxRunner(MemoryOutboxStore(), OutboxSender { SendResult.Delivered }, ManualConnectivity(true), { 1L })
        val files = MemoryOutboxFiles()
        val holder =
            IntakeFormStateHolder(
                clinic,
                backgroundScope,
                online = { true },
                runner = { runner },
                files = { files },
                today = { TODAY },
            )
        holder.state.first { it.notice != null }
        return holder
    }

    private fun IntakeFormHolder.fillMain() {
        setName("Ravi Kulkarni")
        prefillPhone("9876543210")
        setAge("40")
        toggleNoKnownAllergies()
        setReadAloud(true)
        setSignature(byteArrayOf(1))
    }

    private suspend fun FakeBackend.bodies(path: String) =
        requests
            .filter { it.method == HttpMethod.Post && it.url.encodedPath == path }
            .map { it.body.toByteArray().decodeToString() }

    @Test
    fun the_default_is_the_patient_alone_and_a_family_visit_needs_a_complete_member() =
        runTest {
            val holder = holder(FakeBackend())
            assertFalse(holder.state.value.forFamily)
            holder.fillMain()
            holder.setForFamily(true)
            assertEquals(1, holder.state.value.members.size)
            holder.saveAndQueue()
            val key =
                holder.state.value.members
                    .single()
                    .key
            val problems =
                holder.state.value.memberErrors
                    .getValue(key)
            assertEquals(IntakeProblem.Required, problems[IntakeField.Name])
            assertEquals(IntakeProblem.Required, problems[IntakeField.Birth])
            holder.removeMember(key)
            holder.saveAndQueue()
            assertEquals(IntakeProblem.Required, holder.state.value.errors[IntakeField.Members])
            holder.setForFamily(false)
            assertNull(holder.state.value.errors[IntakeField.Members])
        }

    @Test
    fun the_main_patient_is_made_then_each_member_then_linked_and_a_failure_keeps_the_rest() =
        runTest {
            val backend = FakeBackend()
            // Asha and Meera are made; the third profile is refused.
            backend.on(
                PATIENTS,
                { json(patientJson("p-asha", "Asha"), HttpStatusCode.Created) },
                { json(patientJson("p-meera", "Meera"), HttpStatusCode.Created) },
                { apiError(HttpStatusCode.BadRequest, "invalid_request") },
            )
            // Asha is linked; Meera's link is refused.
            backend.on(
                LINKS,
                { json(linkJson("p-asha", "child"), HttpStatusCode.Created) },
                { apiError(HttpStatusCode.Conflict, "conflict") },
            )
            val holder = holder(backend)
            holder.fillMain()
            holder.setForFamily(true)
            val first =
                holder.state.value.members
                    .single()
                    .key
            holder.setMemberName(first, "Asha Kulkarni")
            holder.setMemberAge(first, "9")
            holder.setMemberSex(first, Sex.Female)
            holder.addMember()
            holder.addMember()
            val (_, second, third) =
                holder.state.value.members
                    .map { it.key }
            holder.setMemberName(second, "Meera Kulkarni")
            holder.setMemberDateOfBirth(second, "1988-04-02")
            holder.setMemberRelation(second, MemberRelation.Spouse)
            holder.setMemberPhone(second, "9123456780")
            holder.setMemberName(third, "Old Kulkarni")
            holder.setMemberAge(third, "70")
            holder.setMemberRelation(third, MemberRelation.Parent)
            holder.saveAndQueue()
            val done = holder.state.first { it.done != null }.done!!

            val order =
                backend.requests
                    .map { it.method.value + " " + it.url.encodedPath }
                    .filter { it.startsWith("POST") && ("patients" in it || "walk-ins" in it) }
            assertEquals(
                listOf(
                    "POST /api/v1/walk-ins",
                    "POST /api/v1/patients",
                    "POST /api/v1/patients/p9/family",
                    "POST /api/v1/patients",
                    "POST /api/v1/patients/p9/family",
                    "POST /api/v1/patients",
                ),
                order,
            )
            val made = backend.bodies("/api/v1/patients")
            assertTrue(""""full_name":"Asha Kulkarni"""" in made[0] && """"age_years":9""" in made[0], made[0])
            assertTrue(""""phone":"+919876543210"""" in made[0], "the phone defaults to the main person's")
            assertTrue(
                """"phone":"+919123456780"""" in made[1] && """"date_of_birth":"1988-04-02"""" in made[1],
                made[1],
            )
            val links = backend.bodies("/api/v1/patients/p9/family")
            assertTrue(
                """"related_patient_id":"p-asha"""" in links[0] && """"relation":"child"""" in links[0],
                links[0],
            )
            assertTrue(""""relation":"spouse"""" in links[1], links[1])

            assertEquals(
                listOf(
                    FamilyResult(first, "Asha Kulkarni", "p-asha", linked = true),
                    FamilyResult(second, "Meera Kulkarni", "p-meera", linked = false),
                    FamilyResult(third, "Old Kulkarni", null, linked = false),
                ),
                done.family,
            )
            assertEquals(listOf(false, true, true), done.family.map { it.failed })
            assertEquals("p9", done.patientId, "the main patient stays registered")
        }

    @Test
    fun a_visit_for_the_patient_alone_creates_no_family() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend)
            holder.fillMain()
            holder.saveAndQueue()
            val done = holder.state.first { it.done != null }.done!!
            assertEquals(emptyList(), done.family)
            assertEquals(0, backend.bodies("/api/v1/patients").size)
        }
}
