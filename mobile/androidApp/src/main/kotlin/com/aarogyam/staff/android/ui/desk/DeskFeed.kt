package com.aarogyam.staff.android.ui.desk

import com.aarogyam.staff.api.model.DeskConsentFields
import com.aarogyam.staff.api.model.WalkInRequest
import com.aarogyam.staff.api.notifications
import com.aarogyam.staff.api.queue
import com.aarogyam.staff.api.registerWalkIn
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.desk.AvailabilityStrip
import com.aarogyam.staff.desk.DoctorAvailability
import com.aarogyam.staff.desk.RemindResult
import com.aarogyam.staff.desk.availabilityOf
import com.aarogyam.staff.desk.remindDoctor
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Clock
import kotlin.time.Instant

/** The availability strip: hidden without `appointments.read`, loading, unavailable after a failed first load, or loaded. */
sealed interface DeskStripState {
    data object Loading : DeskStripState

    data object Hidden : DeskStripState

    data object Unavailable : DeskStripState

    data class Loaded(
        val strip: AvailabilityStrip,
    ) : DeskStripState
}

/** A waiting token with no call yet: its wait is drawn from [issuedAt] and the clock. */
data class DeskWaiting(
    val tokenId: String,
    val doctor: String?,
    val issuedAt: Instant,
)

/** What the desk home reads live, folded from one `/today`, one `/queue` and one `/notifications` per refresh. */
data class DeskFeedState(
    val strip: DeskStripState = DeskStripState.Loading,
    val doctors: List<DeskDoctor> = emptyList(),
    val waiting: Map<String, DeskWaiting> = emptyMap(),
    /** Patient id to the doctor of their latest token today. */
    val lastDoctor: Map<String, DeskDoctor> = emptyMap(),
    /** Token id to the `collect_payment` notification that asked the desk to collect. */
    val payNotification: Map<String, String> = emptyMap(),
    /** Token id to the bill that notification names. */
    val payInvoice: Map<String, String> = emptyMap(),
    /** Token id to the finish time, for "Doctor may be collecting". */
    val endedAt: Map<String, Instant> = emptyMap(),
    /** Token id to when this phone reminded its doctor, so Remind hides for the server's cooldown. */
    val remindedAt: Map<String, Instant> = emptyMap(),
    /** Counts every completed refresh, so a sheet can re-check its notification on each one. */
    val version: Int = 0,
)

/** The desk home's live data (the iOS DeskV10Feed). Patient data stays in memory and out of logs. */
class DeskFeed(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val clock: () -> Instant = { Clock.System.now() },
) {
    private val canRead = "appointments.read" in clinic.permissions
    private val mutable =
        MutableStateFlow(DeskFeedState(strip = if (canRead) DeskStripState.Loading else DeskStripState.Hidden))
    val state: StateFlow<DeskFeedState> = mutable.asStateFlow()
    private var loading = false

    fun refresh() {
        if (!canRead || loading) return
        loading = true
        scope.launch {
            try {
                load()
            } finally {
                loading = false
            }
        }
    }

    private suspend fun load() {
        val (today, queue) =
            coroutineScope {
                val a = async { clinic.api.today() }
                val b = async { clinic.api.queue() }
                a.await() to b.await()
            }
        if (today !is Outcome.Success || queue !is Outcome.Success) {
            mutable.update {
                if (it.strip is DeskStripState.Loading) {
                    it.copy(
                        strip = DeskStripState.Unavailable,
                    )
                } else {
                    it
                }
            }
            return
        }
        val tokens = queue.value.items
        val minute = minuteOfDay(today.value.asOf, clinic.session.clinic.timezone)
        val built = availabilityOf(today.value, tokens, minute)
        val last = mutableMapOf<String, Pair<Instant, DeskDoctor>>()
        val waits = mutableMapOf<String, DeskWaiting>()
        val ended = mutableMapOf<String, Instant>()
        for (token in tokens) {
            val issued = runCatching { Instant.parse(token.issuedAt) }.getOrNull()
            val doctor = token.practitioner
            if (doctor != null && issued != null && (last[token.patient.id]?.first ?: Instant.DISTANT_PAST) < issued) {
                last[token.patient.id] = issued to DeskDoctor(doctor.id, doctor.displayName, free = false)
            }
            if (token.status == "waiting" && token.calledAt.isNullOrBlank() && issued != null) {
                waits[token.id] = DeskWaiting(token.id, doctor?.displayName, issued)
            }
            if (token.status == "ready_to_bill") {
                token.doneAt?.let { runCatching { Instant.parse(it) }.getOrNull() }?.let { ended[token.id] = it }
            }
        }
        val pay = payNotices()
        mutable.update {
            it.copy(
                strip = DeskStripState.Loaded(built),
                doctors =
                    built.doctors.map { d ->
                        DeskDoctor(d.id, d.name, d.availability == DoctorAvailability.Free)
                    },
                waiting = waits,
                lastDoctor = last.mapValues { e -> e.value.second },
                endedAt = ended,
                payNotification = pay?.first ?: it.payNotification,
                payInvoice = pay?.second ?: it.payInvoice,
                version = it.version + 1,
            )
        }
    }

    private suspend fun payNotices(): Pair<Map<String, String>, Map<String, String>>? {
        val list = (clinic.api.notifications() as? Outcome.Success)?.value ?: return null
        val notice = mutableMapOf<String, String>()
        val bill = mutableMapOf<String, String>()
        for (row in list.items.filter { it.kind == "collect_payment" }) {
            val token = row.queueToken ?: continue
            notice[token.id] = row.id
            row.invoice?.let { bill[token.id] = it.id }
        }
        return notice to bill
    }

    /** Reminds the token's doctor (G1). "Too soon" counts as reminded for the server's `quietSeconds`; "not waiting" reloads. */
    fun remind(tokenId: String) {
        scope.launch {
            val answer = clinic.api.remindDoctor(tokenId)
            when (answer.result) {
                RemindResult.Sent, RemindResult.TooSoon -> {
                    mutable.update { it.copy(remindedAt = it.remindedAt + (tokenId to answer.remindedAt(clock()))) }
                }

                RemindResult.NotWaiting -> {
                    refresh()
                }

                RemindResult.Failed -> {
                    // Nothing to draw.
                }
            }
        }
    }

    /** Checks [patientId] in with [doctorId] (the server's default when null); the token number, or null on failure. */
    suspend fun checkIn(
        patientId: String,
        doctorId: String?,
    ): Int? {
        val request =
            WalkInRequest(
                patientId = patientId,
                practitionerId = doctorId,
                consents = listOf(DeskConsentFields(method = "verbal", purpose = "care")),
            )
        val done = (clinic.api.registerWalkIn(request) as? Outcome.Success)?.value ?: return null
        refresh()
        return done.token?.tokenNumber
    }
}
