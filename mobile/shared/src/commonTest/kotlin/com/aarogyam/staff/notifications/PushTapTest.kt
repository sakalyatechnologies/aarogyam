package com.aarogyam.staff.notifications

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PushTapTest {
    @Test
    fun readsTheFourFieldsFromUserInfo() {
        val tap =
            PushTap.of(
                mapOf(
                    "aps" to mapOf("sound" to "default"),
                    "kind" to "task_due",
                    "org_id" to "org-1",
                    "id" to "n-9",
                    "href" to "/tasks",
                ),
            )
        assertEquals(PushTap("task_due", "org-1", "n-9", "/tasks"), tap)
        assertEquals(PushScreen.Tasks, tap.screen)
    }

    @Test
    fun missingOrNonTextFieldsAreNullAndNeverThrow() {
        val tap = PushTap.of(mapOf("kind" to 5, "org_id" to " ", "href" to null))
        assertNull(tap.kind)
        assertNull(tap.orgId)
        assertNull(tap.notificationId)
        assertEquals(PushScreen.Today, tap.screen)
        assertEquals(PushTap(null, null, null, null), PushTap.of(emptyMap<String, String>()))
    }

    @Test
    fun hrefsMapToScreens() {
        assertEquals(PushScreen.Today, PushTap.screenFor("/today"))
        assertEquals(PushScreen.Queue, PushTap.screenFor("/queue"))
        assertEquals(PushScreen.Queue, PushTap.screenFor("/queue/?room=2"))
        assertEquals(PushScreen.Tasks, PushTap.screenFor("/tasks#mine"))
        assertEquals(PushScreen.Labs, PushTap.screenFor("/labs"))
        assertEquals(PushScreen.TimeOff, PushTap.screenFor("/time-off"))
        assertEquals(PushScreen.TimeOff, PushTap.screenFor("/time-off/abc"))
        assertEquals(PushScreen.Today, PushTap.screenFor("/patients/abc"))
        assertEquals(PushScreen.Today, PushTap.screenFor("/queues"))
        assertEquals(PushScreen.Today, PushTap.screenFor(null))
    }
}
