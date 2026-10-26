package com.aarogyam.staff.notifications

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private val wire = Json { ignoreUnknownKeys = true }

private fun entry(
    id: String,
    kind: String = "task_due",
) = NotificationEntry(id = id, kind = kind)

class NotificationKindsTest {
    @Test
    fun the_new_and_existing_kinds_map_to_a_category() {
        val expected =
            mapOf(
                "patient_waiting" to NotificationCategory.Queue,
                "send_in" to NotificationCategory.Queue,
                "collect_payment" to NotificationCategory.Queue,
                "task_due" to NotificationCategory.Task,
                "task_reminder" to NotificationCategory.Task,
                "task_escalated" to NotificationCategory.Task,
                "time_off_requested" to NotificationCategory.TimeOff,
                "time_off_decided" to NotificationCategory.TimeOff,
                "stock_alert" to NotificationCategory.Stock,
                "booking_requested" to NotificationCategory.Booking,
                "lab_overdue" to NotificationCategory.Lab,
                "payment_due" to NotificationCategory.Payment,
                "recall_due" to NotificationCategory.Recall,
            )
        expected.forEach { (kind, category) ->
            val info = NotificationKinds.of(kind)
            assertEquals(category, info.category, kind)
            assertTrue(info.known, kind)
            assertTrue(info.titleKey.isNotEmpty() && info.icon.isNotEmpty(), kind)
        }
        assertEquals("d9.alert.send_in", NotificationKinds.of("send_in").titleKey)
        assertEquals("bell", NotificationKinds.of("send_in").icon)
        assertEquals("t7.notif.requested", NotificationKinds.of("booking_requested").titleKey)
    }

    @Test
    fun an_unknown_kind_is_generic_and_never_dropped() {
        listOf("brand_new_kind", "", null).forEach {
            val info = NotificationKinds.of(it)
            assertEquals(NotificationCategory.Generic, info.category)
            assertFalse(info.known)
            assertEquals(NotificationKinds.GENERIC_TITLE_KEY, info.titleKey)
            assertEquals(NotificationKinds.GENERIC_ICON, info.icon)
        }
        val rows =
            wire.decodeFromString<NotificationEntries>(
                """{"items":[{"id":"n1","kind":"from_the_future","created_at":"x","read":false,"new_field":1}]}""",
            )
        assertEquals(1, rows.items.size)
        assertEquals(
            NotificationCategory.Generic,
            rows.items
                .single()
                .info.category,
        )
    }

    @Test
    fun a_row_is_deduplicated_by_id_keeping_the_first() {
        val rows = listOf(entry("a"), entry("b"), entry("a", "stock_alert"), entry("c"), entry("b"))
        val deduped = rows.dedupeById()
        assertEquals(listOf("a", "b", "c"), deduped.map { it.id })
        assertEquals("task_due", deduped.first().kind)
    }

    @Test
    fun merging_a_poll_into_the_shown_list_shows_each_id_once_and_takes_the_fresh_copy() {
        val shown = listOf(entry("a"), entry("b"))
        val fresh = listOf(entry("c"), entry("a", "task_escalated"))
        val merged = mergeNotifications(shown, fresh)
        assertEquals(listOf("c", "a", "b"), merged.map { it.id })
        assertEquals("task_escalated", merged[1].kind)
    }

    @Test
    fun handled_is_absent_or_present() {
        val absent =
            wire.decodeFromString<NotificationEntry>(
                """{"id":"n1","kind":"send_in","created_at":"x","read":false}""",
            )
        assertNull(absent.handled)
        assertFalse(absent.isHandled)
        assertTrue(absent.isUnread)
        val nulled =
            wire.decodeFromString<NotificationEntry>(
                """{"id":"n1","kind":"send_in","read":false,"handled":null}""",
            )
        assertFalse(nulled.isHandled)
        val present =
            wire.decodeFromString<NotificationEntry>(
                """{"id":"n1","kind":"collect_payment","read":false,"handled":{"at":"2026-10-12T04:00:00Z","membership_id":"m1","name":"Farah Desk"}}""",
            )
        assertTrue(present.isHandled)
        assertEquals("Farah Desk", present.handled?.name)
        assertFalse(present.isUnread)
    }

    @Test
    fun the_new_fields_decode_when_present() {
        val row =
            wire.decodeFromString<NotificationEntry>(
                """{"id":"n2","kind":"stock_alert","read":true,"href":"/stock","item_name":"Gloves","days_cover":2.5,"due_at":null}""",
            )
        assertEquals("Gloves", row.itemName)
        assertEquals(2.5, row.daysCover)
        assertEquals("/stock", row.href)
        assertTrue(NotificationKinds.carriesOwnTitle(row.kind))
        assertTrue(NotificationKinds.isQueue("patient_waiting"))
        assertFalse(NotificationKinds.isQueue("booking_requested"))
    }
}
