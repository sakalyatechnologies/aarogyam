package com.aarogyam.staff.walkin

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

private const val INTAKE = "$SUNRISE/api/v1/patients/p1/intake"

private const val MASKED_JSON =
    """{"blood_group":"O+","alt_phone":"+91******3210","emergency_contact_name":"Asha",
       "emergency_contact_phone":"+919123456789","occupation":"Teacher","pregnant":true,"due_date":"2027-02-01"}"""

class IntakeEditHolderTest {
    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = DESK,
    ): IntakeEditHolder {
        backend.on(INTAKE, { json(MASKED_JSON) })
        backend.on("$SUNRISE/api/v1/patients/intake-options", {
            json("""{"blood_groups":[],"call_times":[],"health_flags":[],"heard_via":[]}""")
        })
        val clinic = openClinic(backend, testGraph(backend, backgroundScope), this, permissions)
        return IntakeEditHolder(clinic, "p1", female = true, scope = backgroundScope)
    }

    @Test
    fun a_masked_phone_is_kept_as_it_came_and_never_validated() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend)
            val editing = assertIs<IntakeEditState.Editing>(holder.state.first { it is IntakeEditState.Editing })
            assertEquals(mapOf(DetailField.AltPhone to "+91******3210"), editing.masked)
            assertEquals("", editing.details.altPhone)
            assertEquals("9123456789", editing.details.emergencyPhone, "a visible phone is a plain number")
            holder.setDetail(DetailField.AltPhone, "9999999999")
            assertEquals("", assertIs<IntakeEditState.Editing>(holder.state.value).details.altPhone, "read-only")
            holder.setDetail(DetailField.Occupation, "Nurse")
            holder.save()
            holder.state.first { (it as? IntakeEditState.Editing)?.saved == true }
            val put = backend.requests.last { it.method == HttpMethod.Put }
            val body = put.body.toByteArray().decodeToString()
            assertTrue("\"alt_phone\":\"+91******3210\"" in body, body)
            assertTrue("\"emergency_contact_phone\":\"+919123456789\"" in body)
            assertTrue("\"occupation\":\"Nurse\"" in body && "\"blood_group\":\"O+\"" in body)
        }

    @Test
    fun without_patients_write_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, permissions = listOf("patients.read"))
            assertEquals(IntakeEditState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(INTAKE))
        }

    @Test
    fun a_bad_typed_phone_stops_the_save() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend)
            holder.state.first { it is IntakeEditState.Editing }
            holder.setDetail(DetailField.DoctorPhone, "12345")
            holder.save()
            val now = assertIs<IntakeEditState.Editing>(holder.state.value)
            assertEquals(IntakeProblem.Invalid, now.errors[IntakeField.DoctorPhone])
            val puts = backend.requests.count { it.method == HttpMethod.Put && it.url.encodedPath.endsWith("intake") }
            assertEquals(0, puts)
        }

    @Test
    fun the_mask_check_sees_stars_only() {
        assertTrue(isMaskedPhone("+91******3210"))
        assertTrue(!isMaskedPhone("+919876543210"))
        assertTrue(!isMaskedPhone(null))
    }
}
