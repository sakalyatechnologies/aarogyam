package com.aarogyam.staff.live

import com.aarogyam.staff.AppForeground
import com.aarogyam.staff.PollingUpdates
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.notifications.notificationEntries
import com.aarogyam.staff.pollWhileInFront
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A banner for one new notification: its [kind] and token number only, never a patient's name. */
data class LiveBanner(
    val notificationId: String,
    val kind: String,
    val tokenNumber: Int?,
)

/** [banner] boxed, because SwiftUI's screen host cannot take a nullable flow. */
data class LiveBannerState(
    val banner: LiveBanner? = null,
)

/**
 * Watches the unread notifications while the app is in front and raises a [banner] for a new
 * `patient_waiting`, `send_in` or `collect_payment`. The first load only records what is there, so opening the
 * app never replays old rows. The server already filters by audience.
 */
class LiveBannerHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val inFront: StateFlow<Boolean> = AppForeground.inFront,
    private val periodMillis: Long = PollingUpdates.POLL_MILLIS,
) {
    private val mutable = MutableStateFlow<LiveBanner?>(null)
    val banner: StateFlow<LiveBanner?> = mutable.asStateFlow()
    private val boxed = MutableStateFlow(LiveBannerState())
    val state: StateFlow<LiveBannerState> = boxed.asStateFlow()

    private val seen = LinkedHashSet<String>()
    private var primed = false

    init {
        scope.launch { pollWhileInFront(periodMillis, inFront) { load() } }
    }

    fun dismiss() {
        show(null)
    }

    private fun show(banner: LiveBanner?) {
        mutable.value = banner
        boxed.value = LiveBannerState(banner)
    }

    private suspend fun load() {
        when (val result = clinic.api.notificationEntries(unreadOnly = true, limit = 20)) {
            is Outcome.Success -> {
                val fresh = result.value.items.filter { it.id !in seen }
                fresh.forEach { seen.add(it.id) }
                while (seen.size > MAX_SEEN) seen.remove(seen.first())
                if (primed) {
                    fresh.firstOrNull { it.kind in KINDS && !it.isHandled }?.let {
                        show(LiveBanner(it.id, it.kind, it.queueToken?.number))
                    }
                }
                primed = true
            }

            is Outcome.Failure -> {
                // Keep what is shown; the next poll tries again.
            }
        }
    }

    private companion object {
        const val MAX_SEEN = 200
        val KINDS = setOf("patient_waiting", "send_in", "collect_payment")
    }
}
