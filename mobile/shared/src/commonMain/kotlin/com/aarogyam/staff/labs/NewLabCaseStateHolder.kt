package com.aarogyam.staff.labs

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.createLabOrder
import com.aarogyam.staff.api.model.NewLabOrder
import com.aarogyam.staff.api.model.NewLabOrderItem
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** One piece of work on the new case. */
data class LabWork(
    val workType: String,
    val teeth: List<Int> = emptyList(),
    val shade: String = "",
    val material: String = "",
    val qty: Int = 1,
)

data class NewLabCaseState(
    val labId: String? = null,
    val contactId: String? = null,
    val work: List<LabWork> = emptyList(),
    val dueOn: String? = null,
    val instructions: String = "",
    val saving: Boolean = false,
    val error: ScreenError? = null,
    /** The created case's number (`LAB-12`), once saved. */
    val created: String? = null,
) {
    val canSave: Boolean get() = labId != null && work.any { it.workType.isNotBlank() } && !saving && created == null
}

/**
 * "New lab case" for [patientId], from Patient 360 or inside [visitId]: lab, contact, work items,
 * due date and instructions, then `POST /lab-orders`, sent at once or kept as a draft.
 */
class NewLabCaseStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val visitId: String?,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.labs"),
) {
    private val mutableState = MutableStateFlow(NewLabCaseState())
    val state: StateFlow<NewLabCaseState> = mutableState.asStateFlow()

    fun chooseLab(
        labId: String,
        contactId: String? = null,
    ) = mutableState.update { it.copy(labId = labId, contactId = contactId, error = null) }

    fun addWork(work: LabWork) = mutableState.update { it.copy(work = (it.work + work).take(MAX_ITEMS)) }

    fun removeWork(index: Int) = mutableState.update { it.copy(work = it.work.filterIndexed { i, _ -> i != index }) }

    fun setDue(day: String?) = mutableState.update { it.copy(dueOn = day) }

    fun setInstructions(text: String) = mutableState.update { it.copy(instructions = text.take(MAX_INSTRUCTIONS)) }

    fun save(send: Boolean) {
        val s = mutableState.value
        val lab = s.labId ?: return
        if (!s.canSave || LABS_WRITE !in clinic.permissions) return
        mutableState.update { it.copy(saving = true, error = null) }
        scope.launch {
            val body =
                NewLabOrder(
                    vendorId = lab,
                    patientId = patientId,
                    items =
                        s.work.filter { it.workType.isNotBlank() }.map {
                            NewLabOrderItem(
                                workType = it.workType.trim(),
                                teeth = it.teeth.distinct().map(Int::toLong),
                                shade = it.shade.trim().ifEmpty { null },
                                material = it.material.trim().ifEmpty { null },
                                qty = it.qty,
                            )
                        },
                    contactId = s.contactId,
                    dueOn = s.dueOn,
                    encounterId = visitId,
                    instructions = s.instructions.trim().ifEmpty { null },
                    send = send,
                )
            when (val answer = clinic.api.createLabOrder(body)) {
                is Outcome.Success -> {
                    log.info("labs.case_created") { id("lab_order", answer.value.id) }
                    mutableState.update { it.copy(saving = false, created = answer.value.number) }
                }

                is Outcome.Failure -> {
                    log.warn("labs.case_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    private companion object {
        const val LABS_WRITE = "labs.write"
        const val MAX_ITEMS = 50
        const val MAX_INSTRUCTIONS = 2000
    }
}
