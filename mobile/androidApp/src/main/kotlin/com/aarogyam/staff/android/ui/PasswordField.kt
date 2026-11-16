package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.sakalya.mobile.design.Radii
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** A text field in the look of the kit's `SkTextField`, with the characters hidden and the password autofill hint. */
@Composable
fun PasswordField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    supportingText: String? = null,
) {
    val colors = SkTheme.colors
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().semantics { contentType = ContentType.Password },
        label = { Text(label) },
        supportingText = supportingText?.let { { Text(it) } },
        isError = supportingText != null,
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions =
            KeyboardOptions(
                keyboardType = KeyboardType.Password,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        textStyle = SkTypography.bodyText,
        shape = RoundedCornerShape(Radii.M.dp),
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedBorderColor = colors.primary.color,
                unfocusedBorderColor = colors.textMuted.color,
                focusedLabelColor = colors.primaryText.color,
                cursorColor = colors.primary.color,
                focusedContainerColor = colors.card.color,
                unfocusedContainerColor = colors.card.color,
            ),
    )
}
