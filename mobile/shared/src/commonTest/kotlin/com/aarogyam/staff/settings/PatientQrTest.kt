package com.aarogyam.staff.settings

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PatientQrTest {
    private val owner = setOf("settings.manage", "patients.read", "appointments.write")
    private val desk = setOf("patients.read", "appointments.write", "intake.write")
    private val finance = setOf("finance.view")

    @Test
    fun checkInQrNeedsPatientsRead() {
        assertTrue(PatientQr.canShowCheckInQr(owner))
        assertTrue(PatientQr.canShowCheckInQr(desk))
        assertFalse(PatientQr.canShowCheckInQr(finance))
        assertFalse(PatientQr.canShowCheckInQr(emptySet()))
    }

    @Test
    fun theSwitchAndNewKeyStayWithSettingsManage() {
        assertTrue(PatientQr.canManageCheckInQr(owner))
        assertFalse(PatientQr.canManageCheckInQr(desk))
    }

    @Test
    fun bookNeedsAppointmentsWrite() {
        assertTrue(PatientQr.canBook(desk))
        assertFalse(PatientQr.canBook(setOf("settings.manage")))
    }

    @Test
    fun bookTabShowsForEveryone() {
        assertEquals(listOf(PatientQrTab.CheckIn, PatientQrTab.Book), PatientQr.tabs(owner))
        assertEquals(listOf(PatientQrTab.CheckIn, PatientQrTab.Book), PatientQr.tabs(desk))
        assertEquals(listOf(PatientQrTab.Book), PatientQr.tabs(finance))
        assertEquals(listOf(PatientQrTab.Book), PatientQr.tabs(emptySet()))
    }

    @Test
    fun initialFallsBackToAnAllowedTab() {
        assertEquals(PatientQrTab.CheckIn, PatientQr.initial(owner, PatientQrTab.CheckIn))
        assertEquals(PatientQrTab.Book, PatientQr.initial(owner, PatientQrTab.Book))
        assertEquals(PatientQrTab.CheckIn, PatientQr.initial(desk, PatientQrTab.CheckIn))
        assertEquals(PatientQrTab.Book, PatientQr.initial(finance, PatientQrTab.CheckIn))
    }
}
