package com.aarogyam.staff.walkin

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.lookupByPhone
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.sexOf
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Looks up registered patients by phone after a short pause; a newer number cancels an older
 * lookup, and the same number twice sends nothing new.
 */
internal class PhoneLookupRunner(
    private val api: ClinicApi,
    private val scope: CoroutineScope,
    private val debounceMillis: Long,
    private val log: Logger,
    private val publish: (LookupState) -> Unit,
) {
    private var job: Job? = null
    private var requested: String? = null

    /** Looks up [phone] (ten digits), or stops looking when it is null. */
    fun request(phone: String?) {
        if (phone != null && phone == requested) return
        job?.cancel()
        requested = phone
        if (phone == null) return
        publish(LookupState.Looking)
        job =
            scope.launch {
                delay(debounceMillis)
                when (val result = api.lookupByPhone("+91$phone")) {
                    is Outcome.Success -> {
                        val rows =
                            result.value.items.map {
                                PhoneMatchRow(
                                    it.id,
                                    it.fullName,
                                    it.number,
                                    it.ageYears,
                                    sexOf(it.sex),
                                )
                            }
                        publish(LookupState.Matches(rows))
                    }

                    is Outcome.Failure -> {
                        log.warn("walkin.lookup_failed") { code("error", result.error.code.value) }
                        requested = null
                        publish(LookupState.Failed)
                    }
                }
            }
    }

    companion object {
        const val DEBOUNCE_MILLIS = 300L
    }
}

/** Active doctors and the allergy chips; either may be empty when its request fails (the form still works). */
internal suspend fun loadWalkInReference(clinic: ClinicContext): Pair<List<DoctorOption>, List<String>> {
    // ReferenceData serialises its requests behind one lock, so these run one after the other.
    val doctorList =
        (clinic.reference.practitioners() as? Outcome.Success)
            ?.value
            ?.filter { it.active }
            ?.map { DoctorOption(it.id, it.displayName) }
            .orEmpty()
    val pickList =
        (clinic.reference.quickPicks() as? Outcome.Success)
            ?.value
            ?.allergies
            ?.map { it.label }
            .orEmpty()
    return doctorList to pickList
}
