package com.aarogyam.patient.android.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.android.R
import com.aarogyam.patient.devices.DeviceView
import com.aarogyam.patient.devices.DevicesStateHolder
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard

/** Signed-in devices: where this account is signed in, with Sign out on the others (after a confirm). */
@Composable
fun DevicesScreen(
    holder: DevicesStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    PatientScreen(stringResource(R.string.devices_title), onBack = onBack) {
        state.error?.let { error -> item { ErrorState(error, holder::refresh) } }
        if (state.loading && state.devices.isEmpty()) item { LoadingIndicator() }
        if (state.signOutFailed) item { BodyText(stringResource(R.string.devices_sign_out_failed), muted = true) }
        devices(state.devices, state.signingOut, holder::askSignOut)
    }
    if (state.confirming != null) {
        AlertDialog(
            onDismissRequest = holder::cancelConfirm,
            title = { Text(stringResource(R.string.devices_confirm_title)) },
            text = { Text(stringResource(R.string.devices_confirm_message)) },
            confirmButton = { TextButton(holder::confirmSignOut) { Text(stringResource(R.string.sign_out)) } },
            dismissButton = { TextButton(holder::cancelConfirm) { Text(stringResource(R.string.keep_signed_in)) } },
        )
    }
}

private fun LazyListScope.devices(
    devices: List<DeviceView>,
    signingOut: String?,
    onSignOut: (String) -> Unit,
) {
    items(devices.size, key = { devices[it].id }) { index ->
        val device = devices[index]
        SkCard {
            SectionTitle(
                stringResource(if (device.current) R.string.devices_this_device else R.string.devices_other_device),
            )
            device.lastActive?.let {
                BodyText(stringResource(R.string.devices_last_active, it.dateTime()), muted = true)
            }
            device.signedInAt?.let {
                BodyText(stringResource(R.string.devices_signed_in, it.date()), muted = true)
            }
            if (!device.current) {
                SkButton(
                    stringResource(R.string.sign_out),
                    { onSignOut(device.id) },
                    Modifier.fillMaxWidth(),
                    variant = SkButtonVariant.Secondary,
                    enabled = signingOut == null,
                )
            }
        }
    }
}
