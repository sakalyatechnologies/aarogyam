package com.aarogyam.staff.android.ui.clinical

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.newCameraTarget
import com.aarogyam.staff.android.ui.resizeToJpeg
import com.aarogyam.staff.expenses.ExpensesStateHolder
import com.aarogyam.staff.expenses.PayMethod
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import kotlinx.coroutines.launch

/**
 * Bill photo on the Add expense sheet: the system camera (the photo picker where the phone has none)
 * hands back a shrunken JPEG, kept in the draft until the expense is saved. Once attached the
 * button removes it instead.
 */
@Composable
fun BillPhotoButton(
    attached: Boolean,
    onPhoto: (ByteArray) -> Unit,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val hasCamera = remember { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    val target = remember { newCameraTarget(context) }
    val handle: (Uri) -> Unit = { uri -> scope.launch { resizeToJpeg(context, uri)?.let(onPhoto) } }
    val take =
        rememberLauncherForActivityResult(
            ActivityResultContracts.TakePicture(),
        ) { done -> if (done) handle(target.second) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let(handle) }
    if (attached) {
        SkButton(stringResource(R.string.cn_c_expenses_photo_remove), onRemove, modifier, SkButtonVariant.Secondary)
    } else {
        SkButton(stringResource(R.string.cn_c_expenses_photo), {
            if (hasCamera) {
                take.launch(target.second)
            } else {
                pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }
        }, modifier, SkButtonVariant.Secondary)
    }
}

/** The expense was saved but its bill photo did not upload: send it again, or go on without it. */
@Composable
fun BillFailedNotice(holder: ExpensesStateHolder) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        Text(
            stringResource(R.string.cn_c_expenses_bill_failed),
            style = SkTypography.footnote,
            color = SkTheme.colors.dangerText.color,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            SkButton(stringResource(R.string.cn_c_expenses_bill_retry), holder::retryBill, Modifier.weight(1f))
            SkButton(
                stringResource(R.string.cn_c_expenses_bill_skip),
                holder::dropBill,
                Modifier.weight(1f),
                SkButtonVariant.Secondary,
            )
        }
    }
}

/** Opens a fetched bill link with the system (browser or PDF viewer) once; the link is not kept. */
@Composable
fun BillLinkEffect(
    link: String?,
    failed: Boolean,
    /** The failure was a removal, not an open. */
    removing: Boolean,
    onClose: () -> Unit,
) {
    val context = LocalContext.current
    LaunchedEffect(link) {
        val url = link ?: return@LaunchedEffect
        val target = ClinicalFormat.openable(url)
        if (target != null) {
            try {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, target.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: ActivityNotFoundException) {
                // No app can show it; the person sees nothing more to do.
            }
        }
        onClose()
    }
    if (failed) {
        AlertDialog(
            onDismissRequest = onClose,
            text = {
                Text(
                    stringResource(
                        if (removing) {
                            R.string.cn_c_expenses_bill_remove_failed
                        } else {
                            R.string.cn_c_expenses_bill_open_failed
                        },
                    ),
                )
            },
            confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.done)) } },
        )
    }
}

/** A row's bill: open it, or take it off the expense. */
@Composable
fun BillActions(
    onDismiss: () -> Unit,
    onOpen: () -> Unit,
    onRemove: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.cn_c_expenses_photo)) },
        confirmButton = {
            Column {
                TextButton(onClick = {
                    onDismiss()
                    onOpen()
                }) { Text(stringResource(R.string.cn_c_expenses_bill_open)) }
                TextButton(onClick = {
                    onDismiss()
                    onRemove()
                }) {
                    Text(stringResource(R.string.cn_c_expenses_photo_remove), color = SkTheme.colors.dangerText.color)
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cn_c_expenses_cancel)) }
            }
        },
    )
}

fun methodLabel(method: PayMethod): Int =
    when (method) {
        PayMethod.Upi -> R.string.cn_c_pay_upi
        PayMethod.Cash -> R.string.cn_c_pay_cash
        PayMethod.Card -> R.string.cn_c_pay_card
        PayMethod.Bank -> R.string.cn_c_pay_bank
    }
