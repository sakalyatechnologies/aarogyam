package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.walkin.AddressField
import com.aarogyam.staff.walkin.AddressForm
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTextField

/**
 * The optional postal address of a new patient. A full six-digit PIN fills district and state,
 * which stay editable.
 */
@Composable
fun AddressSection(
    address: AddressForm,
    onChange: (AddressField, String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        Field(R.string.address_line1, address.line1) { onChange(AddressField.Line1, it) }
        Field(R.string.address_locality, address.locality) { onChange(AddressField.Locality, it) }
        Field(R.string.address_city, address.city) { onChange(AddressField.City, it) }
        SkTextField(
            value = address.pincode,
            onValueChange = { onChange(AddressField.Pincode, it) },
            label = stringResource(R.string.address_pincode),
            supportingText = if (address.pincodeIncomplete) stringResource(R.string.address_pincode_hint) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        Field(R.string.address_district, address.district) { onChange(AddressField.District, it) }
        Field(R.string.address_state, address.state) { onChange(AddressField.State, it) }
    }
}

@Composable
private fun Field(
    label: Int,
    value: String,
    onChange: (String) -> Unit,
) = SkTextField(value = value, onValueChange = onChange, label = stringResource(label))
