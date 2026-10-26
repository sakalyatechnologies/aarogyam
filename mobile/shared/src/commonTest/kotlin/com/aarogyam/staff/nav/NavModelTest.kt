package com.aarogyam.staff.nav

import com.aarogyam.staff.nav.MoreTile.Analytics
import com.aarogyam.staff.nav.MoreTile.ClinicQr
import com.aarogyam.staff.nav.MoreTile.Expenses
import com.aarogyam.staff.nav.MoreTile.Help
import com.aarogyam.staff.nav.MoreTile.LabWork
import com.aarogyam.staff.nav.MoreTile.Language
import com.aarogyam.staff.nav.MoreTile.Messages
import com.aarogyam.staff.nav.MoreTile.RxSets
import com.aarogyam.staff.nav.MoreTile.Settings
import com.aarogyam.staff.nav.MoreTile.SignOut
import com.aarogyam.staff.nav.MoreTile.Stock
import com.aarogyam.staff.nav.MoreTile.SwitchClinic
import com.aarogyam.staff.nav.MoreTile.Team
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Role templates as seeded by the migrations (0008, 0060, 0170, 0300, 0310, 0360, 0390). */
private object Roles {
    private val chat = setOf("chat.use")
    private val labs = setOf("labs.read", "labs.write")
    val owner =
        setOf(
            "patients.read",
            "patients.write",
            "patients.contact",
            "appointments.read",
            "appointments.write",
            "clinical.read",
            "clinical.write",
            "prescriptions.issue",
            "billing.read",
            "billing.write",
            "finance.view",
            "staff.manage",
            "settings.manage",
            "audit.view",
            "reports.export",
            "inventory.read",
            "inventory.manage",
            "roles.manage",
            "expenses.write",
            "analytics.view",
            "intake.write",
        ) + chat + labs
    val doctor =
        setOf(
            "patients.read",
            "patients.write",
            "patients.contact",
            "appointments.read",
            "appointments.write",
            "clinical.read",
            "clinical.write",
            "prescriptions.issue",
            "billing.read",
            "inventory.read",
            "intake.write",
        ) + chat + labs
    val consultant =
        setOf("patients.read", "appointments.read", "clinical.read", "clinical.write", "prescriptions.issue") + chat
    val frontDesk =
        setOf(
            "patients.read",
            "patients.write",
            "patients.contact",
            "appointments.read",
            "appointments.write",
            "billing.read",
            "billing.write",
            "inventory.read",
            "inventory.manage",
            "intake.write",
        ) + chat + labs
    val assistant =
        setOf("patients.read", "appointments.read", "clinical.read", "inventory.read", "intake.write") + chat + labs
    val finance =
        setOf("patients.read", "billing.read", "billing.write", "finance.view", "reports.export", "expenses.write") +
            chat
}

class NavModelTest {
    private val clinicalTabs = listOf(Tab.Today, Tab.Patients, Tab.Schedule, Tab.More)
    private val tail = listOf(Settings, Language, Help, SignOut)

    @Test
    fun ownerGetsEverythingAndSwitchesClinics() {
        val nav = NavModel.of(Roles.owner, clinicCount = 2)
        assertEquals(clinicalTabs, nav.tabs)
        assertEquals(PrimaryAction.WalkIn, nav.action)
        assertEquals(TodayKind.Clinic, nav.today)
        assertEquals(
            listOf(
                Analytics,
                Expenses,
                Messages,
                Stock,
                LabWork,
                Team,
                ClinicQr,
                RxSets,
                Settings,
                SwitchClinic,
                Language,
                Help,
                SignOut,
            ),
            nav.tiles,
        )
    }

    @Test
    fun doctorSeesNoAnalyticsOrExpenses() {
        val nav = NavModel.of(Roles.doctor, clinicCount = 1)
        assertEquals(clinicalTabs, nav.tabs)
        assertEquals(PrimaryAction.WalkIn, nav.action)
        assertEquals(listOf(Messages, Stock, LabWork, Team, ClinicQr, RxSets) + tail, nav.tiles)
    }

    @Test
    fun consultantHasNoWalkInStockOrLabs() {
        val nav = NavModel.of(Roles.consultant, clinicCount = 1)
        assertEquals(clinicalTabs, nav.tabs)
        assertNull(nav.action)
        assertEquals(listOf(Messages, Team, ClinicQr, RxSets) + tail, nav.tiles)
    }

    @Test
    fun frontDeskAndAssistantRegisterWalkIns() {
        val desk = NavModel.of(Roles.frontDesk, clinicCount = 1)
        assertEquals(PrimaryAction.WalkIn, desk.action)
        assertEquals(listOf(Messages, Stock, LabWork, Team, ClinicQr) + tail, desk.tiles)
        val assistant = NavModel.of(Roles.assistant, clinicCount = 1)
        assertEquals(clinicalTabs, assistant.tabs)
        assertEquals(PrimaryAction.WalkIn, assistant.action)
        assertEquals(listOf(Messages, Stock, LabWork, Team, ClinicQr) + tail, assistant.tiles)
    }

    @Test
    fun financeLeadsWithMoneyAndExpenses() {
        val nav = NavModel.of(Roles.finance, clinicCount = 1)
        assertEquals(listOf(Tab.Today, Tab.Patients, Tab.Expenses, Tab.More), nav.tabs)
        assertEquals(PrimaryAction.AddExpense, nav.action)
        assertEquals(TodayKind.Money, nav.today)
        assertEquals(listOf(Team, ClinicQr) + tail, nav.tiles)
    }

    @Test
    fun aRoleWithNothingStillHasMore() {
        val nav = NavModel.of(emptySet(), clinicCount = 1)
        assertEquals(listOf(Tab.More), nav.tabs)
        assertNull(nav.action)
        assertEquals(listOf(ClinicQr) + tail, nav.tiles)
        assertEquals(Support.Real, nav.support(Team))
    }
}
