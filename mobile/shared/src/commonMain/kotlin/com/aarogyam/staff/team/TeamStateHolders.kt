package com.aarogyam.staff.team

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.badges
import com.aarogyam.staff.api.inbox
import com.aarogyam.staff.api.lowStock
import com.aarogyam.staff.api.model.NewConversationBody
import com.aarogyam.staff.api.notifications
import com.aarogyam.staff.api.readAllNotifications
import com.aarogyam.staff.api.staff
import com.aarogyam.staff.api.startConversation
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** A loaded list, or why it is not. Shared by the small More pages. */
sealed interface ListState<out T> {
    data object Loading : ListState<Nothing>

    /** The role lacks the permission; nothing was requested. */
    data object NotAllowed : ListState<Nothing>

    data class Failed(
        val error: ScreenError,
    ) : ListState<Nothing>

    data class Loaded<T>(
        val items: List<T>,
    ) : ListState<T>
}

/** One team member. */
data class MemberRow(
    val membershipId: String,
    val name: String,
    val roleName: String,
    val active: Boolean,
    /** This is the signed-in person. */
    val me: Boolean,
)

/** One low-stock line. */
data class StockRow(
    val id: String,
    val name: String,
    val unit: String,
    val onHand: Long,
    val reorderLevel: Long,
    val critical: Boolean,
    val nextExpiry: String?,
)

/**
 * One notification or inbox message. A booking one carries [appointmentId]; the queue kinds
 * (`patient_waiting`, `send_in`, `collect_payment`) carry the token, with the patient's clinic
 * number and never the name.
 */
data class AlertRow(
    val id: String,
    val kind: String,
    val read: Boolean,
    val at: String,
    val appointmentId: String,
    val tokenId: String? = null,
    val tokenNumber: Int? = null,
    val patientNumber: String? = null,
    val doctor: String? = null,
)

/** Loads one list once (again on [refresh]) when [permission] is held. */
abstract class SimpleListHolder<T>(
    protected val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val permission: String,
    private val log: Logger,
    private val event: String,
    /** Other permissions that also open the list (the queue alerts reach doctors and billing). */
    private val orPermissions: List<String> = emptyList(),
) {
    private val mutableState = MutableStateFlow<ListState<T>>(ListState.Loading)
    val state: StateFlow<ListState<T>> = mutableState.asStateFlow()

    protected abstract suspend fun fetch(): Outcome<List<T>, com.sakalya.mobile.core.ApiError>

    fun refresh() {
        if (permission !in clinic.permissions && orPermissions.none { it in clinic.permissions }) {
            mutableState.value = ListState.NotAllowed
            return
        }
        scope.launch {
            mutableState.value =
                when (val answer = fetch()) {
                    is Outcome.Success -> {
                        ListState.Loaded(answer.value)
                    }

                    is Outcome.Failure -> {
                        log.warn(event) { code("error", answer.error.code.value) }
                        ListState.Failed(ScreenError.of(answer.error))
                    }
                }
        }
    }
}

/** The owner's team list (`GET /staff`, needs `staff.manage`). */
class TeamStateHolder(
    clinic: ClinicContext,
    private val scope: CoroutineScope,
    log: Logger = Logger("aarogyam.team"),
) : SimpleListHolder<MemberRow>(clinic, scope, STAFF_MANAGE, log, "team.load_failed") {
    private val mutableOpened = MutableStateFlow<String?>(null)

    /** The direct conversation just opened with [message], for the screen to show. */
    val opened: StateFlow<String?> = mutableOpened.asStateFlow()

    init {
        refresh()
    }

    override suspend fun fetch() =
        when (val answer = clinic.api.staff()) {
            is Outcome.Success -> {
                Outcome.Success(
                    answer.value.members.map {
                        MemberRow(
                            it.id,
                            it.displayName,
                            it.roleName,
                            it.status == "active",
                            it.id == clinic.session.membership.id,
                        )
                    },
                )
            }

            is Outcome.Failure -> {
                answer
            }
        }

    /** Opens (or finds) the direct conversation with [membershipId]; needs `chat.use`. */
    fun message(membershipId: String) {
        if (CHAT_USE !in clinic.permissions) return
        scope.launch {
            val answer = clinic.api.startConversation(NewConversationBody(kind = "direct", membershipId = membershipId))
            if (answer is Outcome.Success) mutableOpened.value = answer.value.id
        }
    }

    fun consumeOpened() {
        mutableOpened.value = null
    }

    private companion object {
        const val STAFF_MANAGE = "staff.manage"
        const val CHAT_USE = "chat.use"
    }
}

/** The Stock page: items at or below their reorder level (`GET /stock/low`). */
class StockStateHolder(
    clinic: ClinicContext,
    scope: CoroutineScope,
    log: Logger = Logger("aarogyam.stock"),
) : SimpleListHolder<StockRow>(clinic, scope, "inventory.read", log, "stock.load_failed") {
    init {
        refresh()
    }

    override suspend fun fetch() =
        when (val answer = clinic.api.lowStock()) {
            is Outcome.Success -> {
                Outcome.Success(
                    answer.value.items.map {
                        StockRow(
                            it.item.id,
                            it.item.name,
                            it.item.unit,
                            it.onHand,
                            it.item.reorderLevel,
                            it.status == "critical",
                            it.nextExpiry,
                        )
                    },
                )
            }

            is Outcome.Failure -> {
                answer
            }
        }
}

/** The notifications sheet (`GET /notifications`), with read-all. */
class NotificationsStateHolder(
    clinic: ClinicContext,
    private val scope: CoroutineScope,
    log: Logger = Logger("aarogyam.notifications"),
) : SimpleListHolder<AlertRow>(
        clinic,
        scope,
        "appointments.read",
        log,
        "notifications.load_failed",
        listOf("labs.read", "billing.write", "finance.view", "clinical.write"),
    ) {
    init {
        refresh()
    }

    override suspend fun fetch() =
        when (val answer = clinic.api.notifications()) {
            is Outcome.Success -> {
                Outcome.Success(
                    answer.value.items.map {
                        val token = it.queueToken
                        AlertRow(
                            it.id,
                            it.kind,
                            it.read,
                            it.createdAt,
                            it.appointment?.id.orEmpty(),
                            tokenId = token?.id,
                            tokenNumber = token?.tokenNumber,
                            patientNumber = token?.patientNumber,
                            doctor = token?.practitionerName,
                        )
                    },
                )
            }

            is Outcome.Failure -> {
                answer
            }
        }

    fun readAll() {
        scope.launch { if (clinic.api.readAllNotifications() is Outcome.Success) refresh() }
    }
}

/** The Messages page: booking reminders and escalations (`GET /inbox`). */
class InboxStateHolder(
    clinic: ClinicContext,
    scope: CoroutineScope,
    log: Logger = Logger("aarogyam.inbox"),
) : SimpleListHolder<AlertRow>(clinic, scope, "appointments.read", log, "inbox.load_failed") {
    init {
        refresh()
    }

    override suspend fun fetch() =
        when (val answer = clinic.api.inbox()) {
            is Outcome.Success -> {
                Outcome.Success(
                    answer.value.items.map {
                        AlertRow(it.id, it.kind, !it.open, it.createdAt, it.appointmentId)
                    },
                )
            }

            is Outcome.Failure -> {
                answer
            }
        }
}

/** Unread counts for the bell and the Team tile, from `GET /me/badges`. */
data class BadgeCounts(
    val chat: Int,
    val notifications: Int,
)

/** Reads the badges once per call; the screen calls [refresh] on its minute poll. */
class BadgesStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow(BadgeCounts(0, 0))
    val state: StateFlow<BadgeCounts> = mutableState.asStateFlow()

    fun refresh() {
        if ("chat.use" !in clinic.permissions && "appointments.read" !in clinic.permissions) return
        scope.launch {
            val answer = clinic.api.badges()
            if (answer is Outcome.Success) {
                mutableState.update {
                    BadgeCounts(
                        answer.value.chatUnread.toInt(),
                        answer.value.notificationsUnread?.toInt() ?: 0,
                    )
                }
            }
        }
    }
}
