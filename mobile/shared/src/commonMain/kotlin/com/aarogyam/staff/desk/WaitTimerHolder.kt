package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.config.caps.ServerCaps
import com.aarogyam.staff.today.parseInstant
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.Instant

/** A waiting token's wait: [Fresh] under a minute, [NoReply] at a minute or more without `called`. */
enum class WaitState { Fresh, NoReply }

/** The seconds after which a waiting token with no call turns [WaitState.NoReply] (R11). */
const val NO_REPLY_AFTER_SECONDS: Long = 60

/** The display text key for a [WaitState.NoReply] card: "Check with Dr X" (the screen's strings table maps it). */
const val CHECK_WITH_DOCTOR_KEY: String = "wait.check_with_doctor"

/**
 * One waiting token for the A7 card. [doctor] is the practitioner's display name, null when the
 * token has none (the card then reads "Check with the doctor"). Display only.
 */
data class WaitEntry(
    val tokenId: String,
    val tokenNumber: Int,
    val doctor: String?,
    val elapsedSeconds: Long,
    val state: WaitState,
) {
    /** "0:42"; minutes are not capped ("75:03"). */
    val clock: String get() = "${elapsedSeconds / 60}:${(elapsedSeconds % 60).toString().padStart(2, '0')}"

    /** The string key to show when [state] is [WaitState.NoReply], else null. */
    val checkWithKey: String? get() = if (state == WaitState.NoReply) CHECK_WITH_DOCTOR_KEY else null
}

/** What the wait timer draws. */
sealed interface WaitTimerState {
    data object Loading : WaitTimerState

    data class Failed(
        val error: ScreenError,
    ) : WaitTimerState

    /** [entries] are waiting tokens with no `called_at`, oldest first. */
    data class Ready(
        val entries: List<WaitEntry>,
    ) : WaitTimerState
}

/**
 * The shared desk wait timer (A7, R11): for each waiting token the time since `issued_at` on an
 * injected clock, Fresh under 60 s, NoReply from 60 s while the token has no `called_at`. A called
 * token leaves the list. Display only: no notifications, no chat. Remind needs G1 (`ServerCaps.queueRemind`);
 * until then [canRemind] is false and [remind] sends nothing.
 *
 * The screen calls [refresh] when the queue changes (live update or poll) and [tick] every second
 * (the holder also ticks itself every [tickMillis]; pass 0 to tick only by hand).
 */
interface WaitTimerHolder {
    val state: StateFlow<WaitTimerState>

    /** True only when the server has the Remind call (G1). False today. */
    val canRemind: Boolean

    /** Reloads `GET /queue`. */
    fun refresh()

    /** Recomputes every elapsed time from the clock without a request. */
    fun tick()

    /** Remind the doctor. Does nothing while [canRemind] is false (no call exists yet). */
    fun remind(tokenId: String)
}

/** Fresh below [NO_REPLY_AFTER_SECONDS], else NoReply. */
fun waitStateOf(elapsedSeconds: Long): WaitState =
    if (elapsedSeconds >= NO_REPLY_AFTER_SECONDS) WaitState.NoReply else WaitState.Fresh

internal class WaitTimerStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val clock: () -> Instant = { Clock.System.now() },
    private val tickMillis: Long = 1_000,
) : WaitTimerHolder {
    private data class Raw(
        val id: String,
        val number: Int,
        val doctor: String?,
        val issuedAt: Instant,
    )

    private var raw: List<Raw> = emptyList()
    private var loaded = false
    private val mutable = MutableStateFlow<WaitTimerState>(WaitTimerState.Loading)

    override val state: StateFlow<WaitTimerState> = mutable.asStateFlow()
    override val canRemind: Boolean get() = ServerCaps.queueRemind

    init {
        refresh()
        if (tickMillis > 0) {
            scope.launch {
                while (true) {
                    delay(tickMillis)
                    tick()
                }
            }
        }
    }

    override fun refresh() {
        scope.launch {
            when (val result = clinic.api.queue()) {
                is Outcome.Success -> {
                    raw =
                        result.value.items
                            .filter { it.status == "waiting" && it.calledAt.isNullOrBlank() }
                            .mapNotNull { t ->
                                parseInstant(
                                    t.issuedAt,
                                )?.let { Raw(t.id, t.tokenNumber, t.practitioner?.displayName, it) }
                            }.sortedBy { it.issuedAt }
                    loaded = true
                    tick()
                }

                is Outcome.Failure -> {
                    // Keep the last good list on screen; only a first load fails the screen.
                    if (!loaded) {
                        mutable.value = WaitTimerState.Failed(ScreenError.of(result.error))
                    }
                }
            }
        }
    }

    override fun tick() {
        if (!loaded) return
        val now = clock()
        mutable.value =
            WaitTimerState.Ready(
                raw.map {
                    val seconds = maxOf(0L, (now - it.issuedAt).inWholeSeconds)
                    WaitEntry(it.id, it.number, it.doctor, seconds, waitStateOf(seconds))
                },
            )
    }

    override fun remind(tokenId: String) {
        // G1 is not shipped: there is no call to make.
    }
}

internal fun createWaitTimer(
    clinic: ClinicContext,
    scope: CoroutineScope,
): WaitTimerHolder = WaitTimerStateHolder(clinic, scope)
