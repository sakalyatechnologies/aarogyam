package com.aarogyam.staff.tasks

import com.aarogyam.staff.LiveUpdates
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.badges
import com.aarogyam.staff.api.model.CompleteBody
import com.aarogyam.staff.api.model.TaskOccurrence
import com.aarogyam.staff.api.model.UsageBody
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.Instant

/** One open task as the list draws it. */
data class TaskRow(
    val id: String,
    val title: String,
    val action: TaskAction,
    /** RFC 3339, the clinic's offset; format it in the clinic's zone. */
    val dueAt: String,
    val overdue: Boolean,
    /** Only on [TaskAction.ConfirmPhotos]: patients seen today whose visit has no photo. */
    val patientsWithoutPhotos: Int?,
    /** Done was sent and the server has not answered; the row stays until it succeeds. */
    val pending: Boolean,
    /** The last Done failed; the row stays so the person can try again. */
    val error: ScreenError?,
)

data class MyTasksState(
    val loading: Boolean = true,
    /** The role lacks `tasks.use`; nothing was requested. */
    val notAllowed: Boolean = false,
    /** Open tasks, overdue first, then by due time. */
    val rows: List<TaskRow> = emptyList(),
    /** `/me/badges.tasks_open` (open tasks of every day); the row count when the badge call fails. */
    val openCount: Int = 0,
    /** Tasks already done today in the list the server sent. */
    val doneCount: Int = 0,
    /** The list failed to load and nothing was loaded before; after a first load a failed refresh keeps the rows. */
    val loadError: ScreenError? = null,
)

/**
 * "My tasks" (v10 A11): `GET /tasks/mine`, Done through `POST .../complete`, the open count from
 * `/me/badges`. A row leaves the list only after the server says yes; then [celebrate] fires once.
 * Call [refresh] on the screen's poll or [observe] live updates.
 */
interface MyTasksHolder {
    val state: StateFlow<MyTasksState>

    /** One event per task finished by this holder: the screen throws confetti. Not replayed. */
    val celebrate: SharedFlow<Unit>

    /** A task can be finished with a proof photo ([completeWithProof]). */
    val proofSupported: Boolean

    fun refresh()

    fun observe(live: LiveUpdates)

    /**
     * Finishes [id]. [note] is trimmed, at most 300 characters, and sent only when not blank.
     * [usage] is for `record_usage`: the lines, or an empty list for "nothing used"; null for any other task.
     * A retry of the same id reuses its `client_id`.
     */
    fun complete(
        id: String,
        note: String?,
        usage: List<UsageLine>?,
    )

    /**
     * [complete] with a proof photo ([proof] is a JPEG, already resized): uploads it, then finishes the
     * task with its file id. A retry after a failed finish reuses the uploaded photo.
     */
    fun completeWithProof(
        id: String,
        note: String?,
        usage: List<UsageLine>?,
        proof: ByteArray,
    )
}

internal const val TASK_NOTE_MAX = 300

private class MyTasksStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val now: () -> Instant,
) : MyTasksHolder {
    private val allowed = "tasks.use" in clinic.permissions
    private val mutable = MutableStateFlow(MyTasksState(loading = allowed, notAllowed = !allowed))
    private val events = MutableSharedFlow<Unit>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    override val state: StateFlow<MyTasksState> = mutable.asStateFlow()
    override val celebrate: SharedFlow<Unit> = events.asSharedFlow()
    override val proofSupported: Boolean = true

    private var items: List<TaskOccurrence> = emptyList()
    private var badge: Int? = null
    private var loaded = false
    private var loading = false
    private val pending = mutableSetOf<String>()
    private val errors = mutableMapOf<String, ScreenError>()
    private val clientIds = mutableMapOf<String, String>()
    private val proofIds = mutableMapOf<String, String>()

    /** Finished here; an answer that was already on the way must not bring the row back. */
    private val finished = mutableSetOf<String>()

    init {
        refresh()
    }

    override fun refresh() {
        if (!allowed || loading) return
        loading = true
        scope.launch {
            try {
                load()
            } finally {
                loading = false
            }
        }
    }

    override fun observe(live: LiveUpdates) {
        scope.launch { live.changes().collect { refresh() } }
    }

    override fun complete(
        id: String,
        note: String?,
        usage: List<UsageLine>?,
    ) = finish(id, note, usage, null)

    override fun completeWithProof(
        id: String,
        note: String?,
        usage: List<UsageLine>?,
        proof: ByteArray,
    ) = finish(id, note, usage, proof)

    private fun finish(
        id: String,
        note: String?,
        usage: List<UsageLine>?,
        proof: ByteArray?,
    ) {
        if (!allowed || id in pending || items.none { it.id == id && it.status == OPEN }) return
        pending += id
        errors.remove(id)
        publish()
        val clientId = clientIds.getOrPut(id) { IdempotencyKey.generate().toString() }
        scope.launch {
            if (proof != null && id !in proofIds) {
                when (val up = clinic.api.uploadTaskProof(id, proof)) {
                    is Outcome.Success -> {
                        proofIds[id] = up.value.proofFileId
                    }

                    is Outcome.Failure -> {
                        fail(id, up.error)
                        return@launch
                    }
                }
            }
            val body =
                CompleteBody(
                    clientId = clientId,
                    note = note?.trim()?.take(TASK_NOTE_MAX)?.ifEmpty { null },
                    usage = usage?.map { UsageBody(itemId = it.itemId, quantity = it.quantity) },
                    proofFileId = proofIds[id],
                )
            when (val answer = clinic.api.completeTask(id, body)) {
                is Outcome.Success -> {
                    pending -= id
                    clientIds.remove(id)
                    proofIds.remove(id)
                    finished += id
                    items = items.filterNot { it.id == id }
                    badge = badge?.let { (it - 1).coerceAtLeast(0) }
                    publish()
                    events.tryEmit(Unit)
                    refresh()
                }

                is Outcome.Failure -> {
                    fail(id, answer.error)
                }
            }
        }
    }

    private fun fail(
        id: String,
        error: ApiError,
    ) {
        pending -= id
        errors[id] = ScreenError.of(error)
        publish()
        // 409: someone else finished it, or stock is short. Show the server's state.
        if (error.isConflict()) refresh()
    }

    private suspend fun load() {
        val tasks = clinic.api.myTasks()
        val counts = clinic.api.badges()
        if (counts is Outcome.Success) badge = counts.value.tasksOpen.toInt()
        when (tasks) {
            is Outcome.Success -> {
                val fresh = tasks.value.items
                finished.retainAll(fresh.filter { it.status == OPEN }.map { it.id }.toSet())
                items = fresh.filterNot { it.status == OPEN && it.id in finished }
                loaded = true
                errors.keys.retainAll(items.map { it.id }.toSet())
                clientIds.keys.retainAll(items.map { it.id }.toSet())
                proofIds.keys.retainAll(items.map { it.id }.toSet())
                publish()
            }

            is Outcome.Failure -> {
                if (loaded) {
                    publish()
                } else {
                    mutable.update {
                        it.copy(
                            loading = false,
                            loadError = ScreenError.of(tasks.error),
                        )
                    }
                }
            }
        }
    }

    private fun publish() {
        val at = now()
        val open = items.filter { it.status == OPEN }
        val rows = open.map { it.toRow(at) }.sortedWith(taskOrder)
        mutable.value =
            MyTasksState(
                loading = false,
                notAllowed = !allowed,
                rows = rows,
                openCount = badge ?: rows.size,
                doneCount = items.count { it.status == "done" },
            )
    }

    private fun TaskOccurrence.toRow(at: Instant) =
        TaskRow(
            id = id,
            title = title,
            action = TaskAction.of(action),
            dueAt = dueAt,
            overdue = dueInstant(dueAt)?.let { it < at } ?: false,
            patientsWithoutPhotos = patientsWithoutPhotosToday?.toInt(),
            pending = id in pending,
            error = errors[id],
        )

    private fun ApiError.isConflict(): Boolean = status == 409
}

private const val OPEN = "open"

private fun dueInstant(text: String): Instant? = runCatching { Instant.parse(text) }.getOrNull()

/** Overdue first, then the soonest due; the id keeps equal times stable. */
internal val taskOrder: Comparator<TaskRow> =
    compareBy<TaskRow> { !it.overdue }
        .thenBy { dueInstant(it.dueAt)?.toEpochMilliseconds() ?: Long.MAX_VALUE }
        .thenBy { it.dueAt }
        .thenBy { it.id }

internal fun createMyTasks(
    clinic: ClinicContext,
    scope: CoroutineScope,
): MyTasksHolder = MyTasksStateHolder(clinic, scope) { Clock.System.now() }

internal fun createMyTasks(
    clinic: ClinicContext,
    scope: CoroutineScope,
    now: () -> Instant,
): MyTasksHolder = MyTasksStateHolder(clinic, scope, now)
