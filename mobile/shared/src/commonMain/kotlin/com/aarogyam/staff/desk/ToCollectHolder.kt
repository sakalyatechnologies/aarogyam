package com.aarogyam.staff.desk

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.ToCollectItem
import com.aarogyam.staff.api.toCollect
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the To collect list draws. */
sealed interface ToCollectState {
    data object Loading : ToCollectState

    /** The role has neither `payments.collect` nor `billing.read`; nothing was requested. */
    data object NotAllowed : ToCollectState

    data class Failed(
        val error: ScreenError,
    ) : ToCollectState

    /** [items] are bills from earlier days, oldest first; [totalPaise] is their balances added. */
    data class Loaded(
        val items: List<ToCollectItem>,
        val totalPaise: Long,
        /** The same bills, one row per patient: what they owe in all and how many bills. */
        val patients: List<ToCollectPatient> = patientsOf(items),
    ) : ToCollectState
}

/** One patient with bills to collect, their oldest bill first; Collect splits one payment over them. */
data class ToCollectPatient(
    val patientId: String,
    val patientNumber: String,
    val bills: List<ToCollectItem>,
    val totalPaise: Long,
) {
    val billCount: Int get() = bills.size
}

/** The bills grouped by patient, in the order of each patient's oldest bill. */
internal fun patientsOf(items: List<ToCollectItem>): List<ToCollectPatient> =
    items.groupBy { it.patientId }.map { (id, bills) ->
        ToCollectPatient(id, bills.first().patientNumber, bills, bills.sumOf { it.balancePaise })
    }

/** Bills still to collect from earlier days (`GET /queue/to-collect`). */
class ToCollectHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.tocollect"),
) {
    private val allowed = PAYMENTS_COLLECT in clinic.permissions || BILLING_READ in clinic.permissions
    private val mutableState =
        MutableStateFlow<ToCollectState>(if (allowed) ToCollectState.Loading else ToCollectState.NotAllowed)
    val state: StateFlow<ToCollectState> = mutableState.asStateFlow()

    init {
        if (allowed) load()
    }

    /** Reloads the list; the last good list stays on screen until the new one arrives. */
    fun refresh() {
        if (!allowed) return
        if (mutableState.value is ToCollectState.Failed) mutableState.value = ToCollectState.Loading
        load()
    }

    private fun load() {
        scope.launch {
            when (val result = clinic.api.toCollect()) {
                is Outcome.Success -> {
                    val items = result.value.items
                    mutableState.value = ToCollectState.Loaded(items, items.sumOf { it.balancePaise })
                }

                is Outcome.Failure -> {
                    log.warn("tocollect.load_failed") { code("error", result.error.code.value) }
                    // A failed refresh keeps the last good list.
                    if (mutableState.value !is ToCollectState.Loaded) {
                        mutableState.value = ToCollectState.Failed(ScreenError.of(result.error))
                    }
                }
            }
        }
    }

    private companion object {
        const val PAYMENTS_COLLECT = "payments.collect"
        const val BILLING_READ = "billing.read"
    }
}
