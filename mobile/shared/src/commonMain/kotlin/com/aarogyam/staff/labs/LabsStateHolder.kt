package com.aarogyam.staff.labs

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.labOrder
import com.aarogyam.staff.api.labOrders
import com.aarogyam.staff.api.labVendors
import com.aarogyam.staff.api.logLabContact
import com.aarogyam.staff.api.model.LabContactLogChannel
import com.aarogyam.staff.api.model.LabContactLogEntry
import com.aarogyam.staff.api.model.LabContactLogOutcome
import com.aarogyam.staff.api.model.LabOrder
import com.aarogyam.staff.api.model.LabOrderState
import com.aarogyam.staff.api.model.LabOrderStatusChange
import com.aarogyam.staff.api.moveLabOrder
import com.aarogyam.staff.api.remindLab
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Where a case is, as the server names it. */
enum class LabStatus(
    internal val wire: LabOrderState,
) {
    Draft(LabOrderState.DRAFT),
    Sent(LabOrderState.SENT),
    InProgress(LabOrderState.IN_PROGRESS),
    Received(LabOrderState.RECEIVED),
    Fitted(LabOrderState.FITTED),
    Rework(LabOrderState.RETURNED_FOR_REWORK),
    Cancelled(LabOrderState.CANCELLED),
    ;

    /** Still at the lab or on its way back. */
    val open: Boolean get() = this == Sent || this == InProgress || this == Rework

    internal companion object {
        fun of(wire: LabOrderState): LabStatus = entries.first { it.wire == wire }
    }
}

/** One lab case. The patient's name is for the screen only; WhatsApp messages carry [number], never it. */
data class LabCase(
    val id: String,
    val number: String,
    val status: LabStatus,
    val labName: String?,
    val contactName: String?,
    /** E.164 for the dialler and WhatsApp: the contact's, else the lab's own. */
    val phone: String?,
    val whatsapp: Boolean,
    val patientName: String,
    val patientNumber: String,
    val work: List<String>,
    val teeth: List<Int>,
    val dueOn: String?,
    val stage: String?,
    val lastContactedAt: String?,
)

/** One lab of the directory. */
data class LabRow(
    val id: String,
    val name: String,
    val phone: String?,
    val contacts: List<LabPerson>,
)

/** Someone at a lab. */
data class LabPerson(
    val id: String,
    val name: String,
    val phone: String?,
    val whatsapp: Boolean,
)

data class LabsState(
    val allowed: Boolean,
    val canWrite: Boolean,
    val loading: Boolean = false,
    val cases: List<LabCase> = emptyList(),
    val labs: List<LabRow> = emptyList(),
    val overdueOnly: Boolean = false,
    /** A case action in flight. */
    val busy: String? = null,
    val error: ScreenError? = null,
)

/** How a contact went, for the contact log. */
enum class ContactOutcome(
    internal val wire: LabContactLogOutcome,
) {
    Reached(LabContactLogOutcome.REACHED),
    NoAnswer(LabContactLogOutcome.NO_ANSWER),
    PromisedDate(LabContactLogOutcome.PROMISED_DATE),
    Other(LabContactLogOutcome.OTHER),
}

/** How the lab was contacted. */
enum class ContactChannel(
    internal val wire: LabContactLogChannel,
) {
    Call(LabContactLogChannel.CALL),
    WhatsApp(LabContactLogChannel.WHATSAPP),
    Email(LabContactLogChannel.EMAIL),
    Visit(LabContactLogChannel.VISIT),
}

/**
 * Lab work: cases (`GET /lab-orders`) and the directory (`GET /lab-vendors`) in one load, then case
 * actions: move the status, log a call or WhatsApp (with a promised date), and email a reminder.
 */
class LabsStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.labs"),
) {
    private val mutableState =
        MutableStateFlow(
            LabsState(
                allowed = LABS_READ in clinic.permissions,
                canWrite =
                    LABS_WRITE in clinic.permissions,
            ),
        )
    val state: StateFlow<LabsState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    fun showOverdue(only: Boolean) {
        mutableState.update { it.copy(overdueOnly = only) }
        refresh()
    }

    fun refresh() {
        val s = mutableState.value
        if (!s.allowed) return
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            coroutineScope {
                val cases = async { clinic.api.labOrders(overdue = s.overdueOnly) }
                val labs = async { clinic.api.labVendors() }
                val c = cases.await()
                val l = labs.await()
                mutableState.update { st ->
                    st.copy(
                        loading = false,
                        cases = (c as? Outcome.Success)?.value?.items?.map { it.toCase() } ?: st.cases,
                        labs =
                            (l as? Outcome.Success)?.value?.items?.map { v ->
                                LabRow(
                                    v.id,
                                    v.name,
                                    v.phone,
                                    v.contacts.map { LabPerson(it.id, it.name, it.phone, it.whatsapp) },
                                )
                            } ?: st.labs,
                        error = ((c as? Outcome.Failure) ?: (l as? Outcome.Failure))?.let { ScreenError.of(it.error) },
                    )
                }
                (c as? Outcome.Failure)?.let { log.warn("labs.load_failed") { code("error", it.error.code.value) } }
            }
        }
    }

    fun move(
        caseId: String,
        to: LabStatus,
        note: String? = null,
    ) = act(caseId, "labs.move_failed") {
        clinic.api.moveLabOrder(caseId, LabOrderStatusChange(status = to.wire, note = note?.trim()?.ifEmpty { null }))
    }

    /** Records a call, WhatsApp, email or visit; a [promisedOn] date (YYYY-MM-DD) becomes the due date. */
    fun logContact(
        caseId: String,
        channel: ContactChannel,
        outcome: ContactOutcome?,
        note: String? = null,
        promisedOn: String? = null,
    ) = act(caseId, "labs.contact_failed") {
        clinic.api.logLabContact(
            caseId,
            LabContactLogEntry(
                channel = channel.wire,
                outcome = outcome?.wire,
                note =
                    note?.trim()?.ifEmpty {
                        null
                    },
                promisedOn = promisedOn,
            ),
        )
    }

    /** Emails the lab a reminder, then reloads the case for its new contact time. */
    fun remind(caseId: String) =
        act(caseId, "labs.remind_failed") {
            when (val queued = clinic.api.remindLab(caseId)) {
                is Outcome.Success -> clinic.api.labOrder(caseId)
                is Outcome.Failure -> queued
            }
        }

    private fun act(
        caseId: String,
        event: String,
        call: suspend () -> Outcome<LabOrder, ApiError>,
    ) {
        val s = mutableState.value
        if (!s.canWrite || s.busy != null) return
        mutableState.update { it.copy(busy = caseId, error = null) }
        scope.launch {
            when (val answer = call()) {
                is Outcome.Success -> {
                    val updated = answer.value.toCase()
                    mutableState.update { st ->
                        st.copy(
                            busy = null,
                            cases =
                                st.cases.map {
                                    if (it.id ==
                                        caseId
                                    ) {
                                        updated
                                    } else {
                                        it
                                    }
                                },
                        )
                    }
                }

                is Outcome.Failure -> {
                    log.warn(event) {
                        id("lab_order", caseId)
                        code("error", answer.error.code.value)
                    }
                    mutableState.update { it.copy(busy = null, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    private companion object {
        const val LABS_READ = "labs.read"
        const val LABS_WRITE = "labs.write"
    }
}

internal fun LabOrder.toCase() =
    LabCase(
        id = id,
        number = number,
        status = LabStatus.of(status),
        labName = vendorName,
        contactName = contactName,
        phone = contactPhone ?: vendorPhone,
        whatsapp = contactWhatsapp,
        patientName = patientName,
        patientNumber = patientNumber,
        work = items.sortedBy { it.lineNo }.map { it.workType },
        teeth = items.flatMap { it.teeth }.distinct().sorted(),
        dueOn = dueOn,
        stage = stage,
        lastContactedAt = lastContactedAt,
    )
