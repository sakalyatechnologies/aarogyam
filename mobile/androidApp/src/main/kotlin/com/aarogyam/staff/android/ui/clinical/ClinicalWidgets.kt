package com.aarogyam.staff.android.ui.clinical

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.aarogyam.staff.android.R
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import java.time.Instant
import java.time.ZoneOffset

/** Opens [link] (https, tel) in the app that handles it; nothing happens when none does. */
fun Context.openLink(
    link: String,
    dial: Boolean = false,
) {
    val intent =
        Intent(
            if (dial) Intent.ACTION_DIAL else Intent.ACTION_VIEW,
            link.toUri(),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        startActivity(intent)
    } catch (_: ActivityNotFoundException) {
        // No app can take it.
    }
}

/** A row of choices; [selected] ones are filled. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> ChoiceChips(
    options: List<T>,
    selected: (T) -> Boolean,
    label: @Composable (T) -> String,
    onPick: (T) -> Unit,
) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
    ) {
        options.forEach { option ->
            val on = selected(option)
            val colors = SkTheme.colors
            Text(
                label(option),
                style = SkTypography.label,
                color = (if (on) colors.onPrimary else colors.text).color,
                modifier =
                    Modifier
                        .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                        .background((if (on) colors.primary else colors.inset).color, RoundedCornerShape(22.dp))
                        .semantics { this.selected = on }
                        .clickable(role = Role.Button) { onPick(option) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
            )
        }
    }
}

/** A date picker in a dialog; [onPicked] gets `YYYY-MM-DD`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DatePickDialog(
    onPicked: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val state = rememberDatePickerState()
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let {
                    onPicked(
                        Instant
                            .ofEpochMilli(it)
                            .atZone(ZoneOffset.UTC)
                            .toLocalDate()
                            .toString(),
                    )
                }
                onDismiss()
            }) { Text(stringResource(R.string.done)) }
        },
    ) { DatePicker(state) }
}
