package com.aarogyam.staff.walkin

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.PatientAddress
import com.aarogyam.staff.api.pincode
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** A part of the address the desk types. */
enum class AddressField { Line1, Locality, City, District, State, Pincode }

/** An optional postal address as typed. Patient data: shown on screen only, never logged. */
data class AddressForm(
    val line1: String = "",
    val locality: String = "",
    val city: String = "",
    val district: String = "",
    val state: String = "",
    val pincode: String = "",
) {
    /** One to five digits typed: the screen asks for the rest. */
    val pincodeIncomplete: Boolean get() = pincode.isNotEmpty() && pincode.length != PIN_DIGITS

    /** The address to send; null when nothing was typed. An incomplete PIN is left out. */
    fun toApi(): PatientAddress? {
        val address =
            PatientAddress(
                line1 = line1.trim().ifEmpty { null },
                locality = locality.trim().ifEmpty { null },
                city = city.trim().ifEmpty { null },
                district = district.trim().ifEmpty { null },
                state = state.trim().ifEmpty { null },
                pincode = pincode.takeIf { it.length == PIN_DIGITS },
            )
        return address.takeIf { it != PatientAddress() }
    }

    /** [text] in [field]; the PIN keeps digits only, at most six. */
    fun with(
        field: AddressField,
        text: String,
    ): AddressForm =
        when (field) {
            AddressField.Line1 -> copy(line1 = text)
            AddressField.Locality -> copy(locality = text)
            AddressField.City -> copy(city = text)
            AddressField.District -> copy(district = text)
            AddressField.State -> copy(state = text)
            AddressField.Pincode -> copy(pincode = text.filter { it.isDigit() }.take(PIN_DIGITS))
        }

    companion object {
        const val PIN_DIGITS = 6
    }
}

/**
 * Fills district and state when a six-digit PIN is typed (`GET /public/pincodes/{pin}`). They stay
 * editable; a PIN that is unknown or fails to load leaves them as typed.
 */
internal class PincodeAutofill(
    private val api: ClinicApi,
    private val scope: CoroutineScope,
    private val log: Logger,
    /** Applies [change] to the address of the form being edited. */
    private val edit: ((AddressForm) -> AddressForm) -> Unit,
) {
    private var job: Job? = null

    /** Call after the PIN changed to [pin]. */
    fun typed(pin: String) {
        job?.cancel()
        if (pin.length != AddressForm.PIN_DIGITS) return
        job =
            scope.launch {
                when (val result = api.pincode(pin)) {
                    is Outcome.Success -> {
                        val place = result.value
                        edit { if (it.pincode == pin) it.copy(district = place.district, state = place.state) else it }
                    }

                    is Outcome.Failure -> {
                        log.warn("address.pincode_failed") { code("error", result.error.code.value) }
                    }
                }
            }
    }
}
