package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.android.R

/** The top bar's "More": switch clinic, app language and sign out, kept off the crowded bar. */
@Composable
fun MoreMenu(
    color: Color,
    onSwitchClinic: () -> Unit,
    onSignOut: () -> Unit,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    var language by rememberSaveable { mutableStateOf(false) }
    Box {
        BarAction(stringResource(R.string.more), color, { open = true })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.switch_clinic)) }, onClick = {
                open = false
                onSwitchClinic()
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.language)) }, onClick = {
                open = false
                language = true
            })
            DropdownMenuItem(text = { Text(stringResource(R.string.sign_out)) }, onClick = {
                open = false
                onSignOut()
            })
        }
    }
    if (language) LanguageDialog(onDismiss = { language = false })
}
