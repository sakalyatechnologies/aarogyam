package com.aarogyam.staff.android.ui.more

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.signin.DeleteAccountState
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * "Delete account" from More (iOS `DeleteAccountSheet`): what is deleted, what stays with the clinic, then a confirmed
 * delete. On success the session ends and the app returns to sign-in on its own.
 */
@Composable
fun DeleteAccountSheet(
    graph: AppGraph,
    onDismiss: () -> Unit,
) {
    val holder = rememberHolder { graph.deleteAccount(it) }
    val state by holder.state.collectAsStateWithLifecycle()
    var confirming by remember { mutableStateOf(false) }
    val p = SkTheme.palette
    val busy = state is DeleteAccountState.Deleting
    SkModalSheet(stringResource(R.string.sh_store_delete_title), onDismiss) {
        Text(
            stringResource(R.string.sh_store_delete_body),
            style = SkTypography.bodyText,
            color = p.onSurfaceVariant.color,
        )
        Text(
            stringResource(R.string.sh_store_delete_unsent),
            style = SkTypography.bodyText,
            color = p.onSurfaceVariant.color,
        )
        val notice =
            when (val s = state) {
                is DeleteAccountState.LastOwner -> {
                    stringResource(
                        R.string.sh_store_delete_last_owner,
                        s.clinicNames.joinToString(", "),
                    )
                }

                DeleteAccountState.PlatformStaff -> {
                    stringResource(R.string.sh_store_delete_platform)
                }

                DeleteAccountState.NotStaff -> {
                    stringResource(R.string.sh_store_delete_no_staff)
                }

                is DeleteAccountState.Failed -> {
                    stringResource(s.error.message())
                }

                else -> {
                    null
                }
            }
        notice?.let { Text(it, style = SkTypography.footnote, color = p.error.color) }
        SkPillButton(stringResource(R.string.sh_store_delete_button), {
            confirming = true
        }, Modifier.fillMaxWidth(), enabled = !busy, loading = busy)
        SkPillButton(
            stringResource(R.string.sh_store_delete_close),
            {
                holder.reset()
                onDismiss()
            },
            Modifier.fillMaxWidth(),
            variant = SkPillVariant.Ghost,
        )
    }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.sh_store_delete_confirm_title)) },
            text = { Text(stringResource(R.string.sh_store_delete_unsent)) },
            confirmButton = {
                TextButton({
                    confirming = false
                    holder.delete()
                }) { Text(stringResource(R.string.sh_store_delete_button), color = p.error.color) }
            },
            dismissButton = {
                TextButton(
                    { confirming = false },
                ) { Text(stringResource(R.string.sh_store_delete_cancel)) }
            },
        )
    }
}
