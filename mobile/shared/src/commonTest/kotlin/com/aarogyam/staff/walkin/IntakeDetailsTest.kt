package com.aarogyam.staff.walkin

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class IntakeDetailsTest {
    @Test
    fun an_untouched_form_sends_nothing() {
        assertNull(IntakeDetails().toApi(female = true))
        assertNull(IntakeDetails().healthCodes())
        assertTrue(IntakeDetails().problems(female = true).isEmpty())
    }

    @Test
    fun phones_keep_ten_digits_and_go_out_as_e164() {
        val d =
            IntakeDetails()
                .with(
                    DetailField.AltPhone,
                    "+91 98765 43210",
                ).with(DetailField.EmergencyPhone, "09123456789")
        assertEquals("9876543210", d.altPhone)
        assertEquals("+919876543210", d.toApi(false)?.altPhone)
        assertEquals("+919123456789", d.toApi(false)?.emergencyContactPhone)
    }

    @Test
    fun a_short_phone_is_a_problem_only_when_typed() {
        val d = IntakeDetails().with(DetailField.AltPhone, "98765").with(DetailField.DoctorPhone, "1234567890")
        val problems = d.problems(false)
        assertEquals(IntakeProblem.Invalid, problems[IntakeField.AltPhone])
        assertEquals(IntakeProblem.Invalid, problems[IntakeField.DoctorPhone], "a mobile starts 6 to 9")
        assertNull(problems[IntakeField.EmergencyPhone])
    }

    @Test
    fun none_stands_alone_in_the_checklist() {
        var d = IntakeDetails().toggleHealth("diabetes").toggleHealth("asthma")
        assertEquals(setOf("diabetes", "asthma"), d.health)
        d = d.with(DetailField.HealthOther, "Thyroid").toggleHealth(HEALTH_NONE)
        assertEquals(setOf(HEALTH_NONE), d.health)
        assertEquals("", d.healthOther, "None clears the Other line")
        d = d.toggleHealth("asthma")
        assertEquals(setOf("asthma"), d.health, "a tick clears None")
        assertEquals(listOf("asthma"), d.healthCodes())
        assertEquals(emptySet(), d.toggleHealth("asthma").health)
    }

    @Test
    fun typing_other_clears_none_and_goes_out() {
        val d = IntakeDetails().toggleHealth(HEALTH_NONE).with(DetailField.HealthOther, " Thyroid ")
        assertTrue(HEALTH_NONE !in d.health)
        assertEquals("Thyroid", d.toApi(false)?.healthOther)
    }

    @Test
    fun a_pick_chosen_twice_clears() {
        val d = IntakeDetails().with(DetailField.BloodGroup, "O+")
        assertEquals("O+", d.toApi(false)?.bloodGroup)
        assertEquals("", d.with(DetailField.BloodGroup, "O+").bloodGroup)
    }

    @Test
    fun heard_via_text_goes_only_with_a_pick_and_resets_when_the_pick_changes() {
        val noPick = IntakeDetails().with(DetailField.HeardViaText, "A friend")
        assertNull(noPick.toApi(false), "words with no pick are dropped")
        val picked = noPick.with(DetailField.HeardVia, "other").with(DetailField.HeardViaText, "A friend")
        assertEquals("A friend", picked.toApi(false)?.heardViaText)
        assertEquals("", picked.with(DetailField.HeardVia, "ad").heardViaText)
    }

    @Test
    fun the_women_questions_go_only_for_a_female_patient_and_a_due_date_only_when_pregnant() {
        val d = IntakeDetails().withPregnant(true).with(DetailField.DueDate, "2027-02-01").copy(nursing = false)
        val female = d.toApi(female = true)
        assertEquals(true, female?.pregnant)
        assertEquals("2027-02-01", female?.dueDate)
        assertEquals(false, female?.nursing)
        assertNull(d.toApi(female = false), "male or unset sex: nothing from this section")
        val notPregnant = d.withPregnant(false)
        assertEquals("", notPregnant.dueDate)
        assertNull(notPregnant.toApi(true)?.dueDate)
    }

    @Test
    fun a_bad_due_date_is_a_problem_for_a_pregnant_woman_only() {
        val d = IntakeDetails().withPregnant(true).with(DetailField.DueDate, "2027-13-45")
        assertEquals(IntakeProblem.Invalid, d.problems(female = true)[IntakeField.DueDate])
        assertTrue(d.problems(female = false).isEmpty())
        assertTrue(d.withPregnant(null).problems(female = true).isEmpty())
    }

    @Test
    fun limits_cut_long_text() {
        val d =
            IntakeDetails()
                .with(
                    DetailField.Occupation,
                    "x".repeat(200),
                ).with(DetailField.DoctorAddress, "y".repeat(500))
        assertEquals(80, d.occupation.length)
        assertEquals(300, d.doctorAddress.length)
    }
}
