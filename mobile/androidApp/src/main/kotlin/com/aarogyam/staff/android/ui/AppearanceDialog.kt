package com.aarogyam.staff.android.ui

import androidx.annotation.StringRes
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.device.Appearance
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Applies [appearance] to the whole app; AppCompat recreates the screen in the new look. */
fun applyAppearance(appearance: Appearance) {
    AppCompatDelegate.setDefaultNightMode(
        when (appearance) {
            Appearance.System -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
            Appearance.Light -> AppCompatDelegate.MODE_NIGHT_NO
            Appearance.Dark -> AppCompatDelegate.MODE_NIGHT_YES
        },
    )
}

/** Phone setting, Light or Dark; the look changes as soon as one is picked. */
@Composable
fun AppearanceDialog(
    current: Appearance,
    onPick: (Appearance) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.appearance_title)) },
        text = {
            Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
                Appearance.entries.forEach { appearance ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .selectable(selected = appearance == current, role = Role.RadioButton) {
                                onDismiss()
                                if (appearance != current) onPick(appearance)
                            },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
                    ) {
                        RadioButton(
                            selected = appearance == current,
                            onClick = null,
                            colors = RadioButtonDefaults.colors(selectedColor = SkTheme.colors.primary.color),
                        )
                        Text(
                            stringResource(appearance.label),
                            style = SkTypography.bodyText,
                            color = SkTheme.colors.text.color,
                        )
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.walk_in_close)) } },
    )
}

@get:StringRes
val Appearance.label: Int
    get() =
        when (this) {
            Appearance.System -> R.string.appearance_system
            Appearance.Light -> R.string.appearance_light
            Appearance.Dark -> R.string.appearance_dark
        }
