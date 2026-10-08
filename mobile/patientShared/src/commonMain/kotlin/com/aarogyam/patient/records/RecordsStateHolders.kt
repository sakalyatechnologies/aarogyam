package com.aarogyam.patient.records

import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.api.PatientAppApi
import com.aarogyam.patient.api.model.PatientBills
import com.aarogyam.patient.api.model.PatientPrescriptions
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A read-only list screen: loading, failed, or the rows. */
sealed interface ListState<out T> {
    data object Loading : ListState<Nothing>

    data class Failed(
        val error: ScreenError,
    ) : ListState<Nothing>

    data class Loaded<T>(
        val items: List<T>,
    ) : ListState<T>
}

/** A medicine on a prescription; [timing] is the API's value (`after_food`), for platform copy. */
data class MedicineView(
    val name: String,
    val strength: String?,
    val dose: String,
    val frequency: String,
    val timing: String?,
    val days: Int?,
    val instructions: String?,
)

/** An issued prescription; [verifyUrl] opens the clinic's public verify page. */
data class PrescriptionView(
    val id: String,
    val clinicName: String,
    val number: String,
    val issuedAt: ClinicTime?,
    val doctorName: String?,
    val advice: String?,
    val followUpOn: String?,
    val verifyUrl: String?,
    val medicines: List<MedicineView>,
)

/** A bill line; [label] is what it was for. */
data class BillLineView(
    val label: String,
    val quantity: Int,
    val totalPaise: Long,
)

/** An issued bill and what is still owed on it. */
data class BillView(
    val id: String,
    val clinicName: String,
    val number: String,
    val issuedAt: ClinicTime?,
    val totalPaise: Long,
    val balancePaise: Long,
    val lines: List<BillLineView>,
)

/** The bills screen: what is owed in all, then the bills. */
data class BillsView(
    val balancePaise: Long,
    val bills: List<BillView>,
)

/** Loads one list from the app host into [state], once and on [refresh]. */
abstract class ListStateHolder<B, T>(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
) {
    private val mutableState = MutableStateFlow<ListState<T>>(ListState.Loading)

    /** The current screen state. */
    val state: StateFlow<ListState<T>> = mutableState.asStateFlow()

    protected abstract suspend fun fetch(api: PatientAppApi): Outcome<B, ApiError>

    protected abstract fun rows(
        body: B,
        clinicName: (String) -> String,
    ): List<T>

    /** Reloads. */
    fun refresh() {
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value
                    is Outcome.Failure -> return@launch fail(ScreenError.of(found.error))
                }
            val names =
                (directory.load() as? Outcome.Success)
                    ?.value
                    ?.clinics
                    ?.associate { it.clinicId to it.name }
                    .orEmpty()
            when (val body = fetch(api)) {
                is Outcome.Success -> mutableState.value = ListState.Loaded(rows(body.value) { names[it].orEmpty() })
                is Outcome.Failure -> fail(ScreenError.of(body.error))
            }
        }
    }

    private fun fail(error: ScreenError) {
        if (mutableState.value !is ListState.Loaded) mutableState.value = ListState.Failed(error)
    }
}

/** Issued prescriptions from every linked clinic (`GET /me/patient/prescriptions`). */
class PrescriptionsStateHolder(
    directory: PatientDirectory,
    scope: CoroutineScope,
) : ListStateHolder<PatientPrescriptions, PrescriptionView>(directory, scope) {
    init {
        refresh()
    }

    override suspend fun fetch(api: PatientAppApi): Outcome<PatientPrescriptions, ApiError> = api.prescriptions()

    override fun rows(
        body: PatientPrescriptions,
        clinicName: (String) -> String,
    ): List<PrescriptionView> =
        body.items.map { rx ->
            PrescriptionView(
                id = rx.id,
                clinicName = clinicName(rx.clinicId),
                number = rx.number,
                issuedAt = ClinicTime.parse(rx.issuedAt),
                doctorName = rx.doctorName,
                advice = rx.advice,
                followUpOn = rx.followUpOn,
                verifyUrl = rx.verifyUrl,
                medicines =
                    rx.items.map {
                        MedicineView(
                            it.drugName,
                            it.strength,
                            it.dose,
                            it.frequency,
                            it.timing,
                            it.durationDays,
                            it.instructions,
                        )
                    },
            )
        }
}

/** Issued bills and balances from every linked clinic (`GET /me/patient/bills`); one item, the view. */
class BillsStateHolder(
    directory: PatientDirectory,
    scope: CoroutineScope,
) : ListStateHolder<PatientBills, BillsView>(directory, scope) {
    init {
        refresh()
    }

    override suspend fun fetch(api: PatientAppApi): Outcome<PatientBills, ApiError> = api.bills()

    override fun rows(
        body: PatientBills,
        clinicName: (String) -> String,
    ): List<BillsView> =
        listOf(
            BillsView(
                balancePaise = body.balancePaise,
                bills =
                    body.items.map { bill ->
                        BillView(
                            id = bill.id,
                            clinicName = clinicName(bill.clinicId),
                            number = bill.number,
                            issuedAt = ClinicTime.parse(bill.issuedAt),
                            totalPaise = bill.totalPaise,
                            balancePaise = bill.balancePaise,
                            lines = bill.items.map { BillLineView(it.description, it.quantity, it.totalPaise) },
                        )
                    },
            ),
        )
}
