package com.aarogyam.staff.nav

import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Picks the home tab by permission (v10 R13). [choice] is known at once; for the Doctor home
 * its `practitionerId` fills in after the clinic's doctors load (null when this member has no
 * doctor profile, and then Today is unfiltered).
 */
interface HomeChoiceHolder {
    val choice: StateFlow<HomeChoice>
}

private class PermissionHomeChoice(
    clinic: ClinicContext,
    scope: CoroutineScope,
) : HomeChoiceHolder {
    private val mutable = MutableStateFlow(homeChoiceOf(clinic.permissions))
    override val choice: StateFlow<HomeChoice> = mutable.asStateFlow()

    init {
        if (mutable.value.home == Home.Doctor) {
            scope.launch {
                val me = clinic.session.membership.id
                val id =
                    (clinic.reference.practitioners() as? Outcome.Success)
                        ?.value
                        ?.firstOrNull { it.membershipId == me }
                        ?.id
                if (id != null) mutable.value = mutable.value.copy(practitionerId = id)
            }
        }
    }
}

internal fun createHomeChoice(
    clinic: ClinicContext,
    scope: CoroutineScope,
): HomeChoiceHolder = PermissionHomeChoice(clinic, scope)
