package com.aarogyam.staff.android.ui.walkin

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.walkin.AddressField
import com.aarogyam.staff.walkin.AddressForm
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * The optional postal address of a new patient. A full six-digit PIN fills district and state,
 * which stay editable.
 */
@Composable
fun AddressSection(
    address: AddressForm,
    onChange: (AddressField, String) -> Unit,
) {
    var changing by remember(address.pincode) { mutableStateOf(false) }
    val filled = address.pincode.length == PIN_DIGITS && address.city.isNotEmpty() && address.state.isNotEmpty()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        SkTextField(
            value = address.pincode,
            onValueChange = { onChange(AddressField.Pincode, it) },
            label = stringResource(R.string.address_pincode),
            supportingText = if (address.pincodeIncomplete) stringResource(R.string.address_pincode_hint) else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        if (filled && !changing) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    listOf(address.city, address.district, address.state).filter { it.isNotEmpty() }.joinToString(", "),
                    style = SkTypography.bodyStrong,
                    color = SkTheme.colors.text.color,
                    modifier = Modifier.weight(1f),
                )
                SkButton(
                    stringResource(R.string.address_change),
                    onClick = { changing = true },
                    variant = SkButtonVariant.Secondary,
                )
            }
        } else {
            Field(R.string.address_city, address.city) { onChange(AddressField.City, it) }
            Field(R.string.address_district, address.district) { onChange(AddressField.District, it) }
            Field(R.string.address_state, address.state) { onChange(AddressField.State, it) }
        }
        Field(R.string.address_line1, address.line1) { onChange(AddressField.Line1, it) }
        Field(R.string.address_locality, address.locality) { onChange(AddressField.Locality, it) }
    }
}

private const val PIN_DIGITS = 6

@Composable
private fun Field(
    label: Int,
    value: String,
    onChange: (String) -> Unit,
) = SkTextField(value = value, onValueChange = onChange, label = stringResource(label))
