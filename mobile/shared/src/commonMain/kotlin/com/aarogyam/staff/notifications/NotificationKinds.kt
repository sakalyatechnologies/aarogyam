package com.aarogyam.staff.notifications

import com.aarogyam.staff.api.ClinicApi
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.url
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Which group a bell row belongs to; [Generic] is any kind this build does not know. */
enum class NotificationCategory {
    Queue,
    Task,
    TimeOff,
    Stock,
    Booking,
    Lab,
    Payment,
    Recall,
    Generic,
}

/** How the bell draws one kind: its group, an icon name from the shared icon set and a string key. */
data class NotificationKindInfo(
    val kind: String,
    val category: NotificationCategory,
    val icon: String,
    /** A string-catalog key: `d9.alert.*` (DeskV9), `t7.notif.*` (TodayV7) or `v10.notif.*` (new tables). */
    val titleKey: String,
    val known: Boolean,
)

/** The one mapping from a notification `kind` to its group, icon and title key (v10 A12, R5). */
object NotificationKinds {
    const val GENERIC_ICON = "msg"
    const val GENERIC_TITLE_KEY = "v10.notif.generic"

    private fun info(
        kind: String,
        category: NotificationCategory,
        icon: String,
        key: String,
    ) = NotificationKindInfo(kind, category, icon, key, known = true)

    private val table: Map<String, NotificationKindInfo> =
        listOf(
            info("patient_waiting", NotificationCategory.Queue, "clock", "d9.alert.patient_waiting"),
            info("send_in", NotificationCategory.Queue, "bell", "d9.alert.send_in"),
            info("collect_payment", NotificationCategory.Queue, "check", "d9.alert.collect_payment"),
            info("task_due", NotificationCategory.Task, "check", "v10.notif.task_due"),
            info("task_reminder", NotificationCategory.Task, "bell", "v10.notif.task_reminder"),
            info("task_escalated", NotificationCategory.Task, "alert", "v10.notif.task_escalated"),
            info("time_off_requested", NotificationCategory.TimeOff, "calendar", "v10.notif.time_off_requested"),
            info("time_off_decided", NotificationCategory.TimeOff, "calendar", "v10.notif.time_off_decided"),
            info("stock_alert", NotificationCategory.Stock, "box", "v10.notif.stock_alert"),
            info("booking_requested", NotificationCategory.Booking, "calendar", "t7.notif.requested"),
            info("booking_confirmed_auto", NotificationCategory.Booking, "calendar", "t7.notif.confirmed"),
            info("booking_cancelled_by_patient", NotificationCategory.Booking, "calendar", "t7.notif.cancelled"),
            info("booking_conflict", NotificationCategory.Booking, "calendar", "v10.notif.booking_conflict"),
            info("arrival", NotificationCategory.Queue, "clock", "v10.notif.arrival"),
            info("lab_overdue", NotificationCategory.Lab, "alert", "v10.notif.lab_overdue"),
            info("payment_due", NotificationCategory.Payment, "check", "v10.notif.payment_due"),
            info("recall_due", NotificationCategory.Recall, "bell", "v10.notif.recall_due"),
        ).associateBy { it.kind }

    /** Every kind this build names; the rest map to [of] with `known = false`. */
    val knownKinds: Set<String> get() = table.keys

    /** Never null and never throws: an unknown or empty kind is a generic row. */
    fun of(kind: String?): NotificationKindInfo =
        table[kind]
            ?: NotificationKindInfo(
                kind.orEmpty(),
                NotificationCategory.Generic,
                GENERIC_ICON,
                GENERIC_TITLE_KEY,
                known = false,
            )

    fun isQueue(kind: String?): Boolean =
        of(kind).let {
            it.known && it.category == NotificationCategory.Queue &&
                kind != "arrival"
        }

    /** The kinds whose title comes from the row itself (the task's or item's name) rather than a fixed string. */
    fun carriesOwnTitle(kind: String?): Boolean =
        of(kind).category.let {
            it == NotificationCategory.Task ||
                it == NotificationCategory.Stock
        }
}

/** `handled` as the server sends it once someone has dealt with a row. */
@Serializable
data class HandledStamp(
    val at: String? = null,
    @SerialName("membership_id") val membershipId: String? = null,
    val name: String? = null,
)

/**
 * A notification as the bell needs it, hand-written so a field main has not shipped yet (`handled`,
 * `title`, `item_name`) is simply absent. Unknown keys are ignored by the client's decoder.
 */
@Serializable
data class NotificationEntry(
    val id: String,
    val kind: String = "",
    @SerialName("created_at") val createdAt: String = "",
    val read: Boolean = false,
    val href: String? = null,
    val title: String? = null,
    @SerialName("due_at") val dueAt: String? = null,
    @SerialName("item_name") val itemName: String? = null,
    @SerialName("days_cover") val daysCover: Double? = null,
    val handled: HandledStamp? = null,
) {
    val info: NotificationKindInfo get() = NotificationKinds.of(kind)

    /** True once someone handled it; false when `handled` is absent, including on an older server. */
    val isHandled: Boolean get() = handled != null

    /** A handled row of a queue kind no longer counts as unread (BE4). */
    val isUnread: Boolean get() = !read && !isHandled
}

@Serializable
data class NotificationEntries(
    val items: List<NotificationEntry> = emptyList(),
)

/** Keeps the first row of each id, in order: a banner fed by the poll and the live stream shows a row once. */
fun List<NotificationEntry>.dedupeById(): List<NotificationEntry> = distinctBy { it.id }

/** Folds [fresh] into [shown]: new ids first (newest first as sent), then those already shown, each id once. */
fun mergeNotifications(
    shown: List<NotificationEntry>,
    fresh: List<NotificationEntry>,
): List<NotificationEntry> {
    val latest = fresh.associateBy { it.id }
    return (fresh + shown.map { latest[it.id] ?: it }).dedupeById()
}

/** `GET /api/v1/notifications` through the tolerant [NotificationEntry]. */
suspend fun ClinicApi.notificationEntries(
    unreadOnly: Boolean = false,
    limit: Int? = null,
    before: String? = null,
): Outcome<NotificationEntries, ApiError> =
    client.call {
        url("api/v1/notifications")
        if (unreadOnly) parameter("unread_only", true)
        limit?.let { parameter("limit", it) }
        before?.let { parameter("before", it) }
    }
