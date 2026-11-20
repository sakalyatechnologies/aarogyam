package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.ToothDetailKind
import com.aarogyam.staff.api.model.NewToothEruption
import com.aarogyam.staff.api.setToothCondition
import com.aarogyam.staff.api.setToothEruption
import com.aarogyam.staff.api.toothDetailInError
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** A detail chip being saved, or the last one refused (and taken back). */
data class DetailSaveState(
    val saving: Boolean = false,
    val error: ScreenError? = null,
)

/**
 * The tooth sheet's detail chips (spec 1.13): infection, bleeding, pocket and mobility (one merge
 * PUT per tap), the wisdom tooth's eruption and angle, and the decay depth. Each tap shows at once
 * and is put back if refused. Untapping the last recorded condition removes the row as entered in
 * error, because the server keeps no empty condition.
 */
internal class ToothDetailEditor(
    private val clinic: ClinicContext,
    private val chart: ChartStateHolder,
    private val scope: CoroutineScope,
    private val log: Logger,
) {
    private val mutableState = MutableStateFlow(DetailSaveState())
    val state: StateFlow<DetailSaveState> = mutableState.asStateFlow()

    fun setInfection(
        tooth: Int,
        infection: RootInfection?,
    ) = condition(
        tooth,
        "infection",
        infection?.let {
            JsonPrimitive(it.wire)
        } ?: JsonNull,
    ) { it.copy(infection = infection) }

    fun setBleeding(
        tooth: Int,
        on: Boolean,
    ) = condition(
        tooth,
        "bleeding",
        if (on) JsonPrimitive(true) else JsonNull,
    ) { it.copy(bleeding = true.takeIf { on }) }

    fun setPocket(
        tooth: Int,
        mm: Int?,
    ) = condition(tooth, "pocket_mm", mm?.let(::JsonPrimitive) ?: JsonNull) { it.copy(pocketMm = mm) }

    fun setMobility(
        tooth: Int,
        grade: Int?,
    ) = condition(tooth, "mobility", grade?.let(::JsonPrimitive) ?: JsonNull) { it.copy(mobility = grade) }

    /** The tooth was treated: the infection is cleared, the rest of its condition kept. */
    fun resolveInfection(tooth: Int) = setInfection(tooth, null)

    /** Sets the wisdom tooth's eruption (as the web, a new one starts without an angle). */
    fun setEruption(
        tooth: Int,
        eruption: Eruption,
    ) {
        val before = chart.eruptionOf(tooth)
        if (before?.eruption == eruption) return
        eruption(tooth, ToothEruptionView(eruption, null, before?.at))
    }

    fun setAngulation(
        tooth: Int,
        angulation: Angulation,
    ) {
        val before = chart.eruptionOf(tooth) ?: return
        if (!before.eruption.takesAngle || before.angulation == angulation) return
        eruption(tooth, before.copy(angulation = angulation))
    }

    fun dismissError() {
        mutableState.value = mutableState.value.copy(error = null)
    }

    private fun condition(
        tooth: Int,
        field: String,
        value: JsonElement,
        change: (ToothConditionView) -> ToothConditionView,
    ) {
        if (mutableState.value.saving) return
        val before = chart.conditionOf(tooth)
        val after = change(before ?: ToothConditionView())
        if (!after.recorded) return removeCondition(tooth)
        chart.applyCondition(tooth, after)
        saving()
        scope.launch {
            when (
                val answer =
                    clinic.api.setToothCondition(
                        chart.patientId,
                        tooth,
                        JsonObject(mapOf(field to value)),
                    )
            ) {
                is Outcome.Success -> {
                    log.info("chart.condition_set")
                    chart.applyCondition(tooth, conditionsOf(listOf(answer.value), clinic.timeZone)[tooth])
                    mutableState.value = DetailSaveState()
                }

                is Outcome.Failure -> {
                    chart.applyCondition(tooth, before)
                    failed("chart.condition_failed", answer.error)
                }
            }
        }
    }

    private fun eruption(
        tooth: Int,
        next: ToothEruptionView,
    ) {
        if (mutableState.value.saving) return
        val before = chart.eruptionOf(tooth)
        chart.applyEruption(tooth, next)
        saving()
        scope.launch {
            val body = NewToothEruption(eruption = next.eruption.wire, angulation = next.angulation?.wire)
            when (val answer = clinic.api.setToothEruption(chart.patientId, tooth, body)) {
                is Outcome.Success -> {
                    log.info("chart.eruption_set")
                    chart.applyEruption(tooth, eruptionsOf(listOf(answer.value), clinic.timeZone)[tooth])
                    mutableState.value = DetailSaveState()
                }

                is Outcome.Failure -> {
                    chart.applyEruption(tooth, before)
                    failed("chart.eruption_failed", answer.error)
                }
            }
        }
    }

    /**
     * The last recorded chip was untapped: the server keeps no empty condition, so the row comes
     * off as entered in error.
     */
    private fun removeCondition(tooth: Int) {
        val condition = chart.conditionOf(tooth) ?: return
        chart.applyCondition(tooth, null)
        saving()
        scope.launch {
            when (
                val answer =
                    clinic.api.toothDetailInError(
                        chart.patientId,
                        tooth,
                        ToothDetailKind.Condition,
                        REMOVED,
                    )
            ) {
                is Outcome.Success -> {
                    log.info("chart.condition_removed")
                    mutableState.value = DetailSaveState()
                }

                is Outcome.Failure -> {
                    chart.applyCondition(tooth, condition)
                    failed("chart.condition_remove_failed", answer.error)
                }
            }
        }
    }

    private fun saving() {
        mutableState.value = DetailSaveState(saving = true)
    }

    private fun failed(
        event: String,
        error: ApiError,
    ) {
        log.warn(event) { code("error", error.code.value) }
        mutableState.value = DetailSaveState(error = ScreenError.of(error))
    }

    private companion object {
        /** The reason sent when a chip is untapped and nothing else is left on the row. */
        const val REMOVED = "Removed on the tooth sheet"
    }
}
