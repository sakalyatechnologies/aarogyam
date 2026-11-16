package com.aarogyam.staff.android.ui.labs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.android.ui.clinical.openLink
import com.aarogyam.staff.labs.LabRemindResult
import com.aarogyam.staff.labs.LabSkipped
import com.aarogyam.staff.labs.SkipReason
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** What "Remind all" did: how many labs, who was left out, and one button per WhatsApp link. */
@Composable
fun RemindResultCard(
    result: LabRemindResult,
    onDone: () -> Unit,
) {
    val colors = SkTheme.colors
    val context = LocalContext.current
    SkCard {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            val title =
                when (result.labs.size) {
                    0 -> stringResource(R.string.cn_lv_result_none)
                    1 -> stringResource(R.string.cn_lv_result_one)
                    else -> stringResource(R.string.cn_lv_result_many, result.labs.size)
                }
            Text(title, style = SkTypography.bodyStrong, color = colors.text.color)
            result.labs.forEach { lab ->
                ClinicalFormat.whatsAppLink(lab.waLink)?.let { link ->
                    SkButton(stringResource(R.string.cn_lv_result_open_wa, lab.vendorName), {
                        context.openLink(link)
                    }, Modifier.fillMaxWidth(), SkButtonVariant.Secondary)
                }
            }
            if (result.skipped.isNotEmpty()) {
                val text = result.skipped.map { skipText(it) }.joinToString("; ")
                Text(
                    stringResource(R.string.cn_lv_result_skipped, text),
                    style = SkTypography.footnote,
                    color = colors.textMuted.color,
                )
            }
            SkButton(
                stringResource(R.string.cn_lv_result_done),
                onDone,
                Modifier.fillMaxWidth(),
                SkButtonVariant.Secondary,
            )
        }
    }
}

@Composable
private fun skipText(item: LabSkipped): String =
    stringResource(
        when (item.reason) {
            SkipReason.NotAtLab -> R.string.cn_lv_skip_not_at_lab
            SkipReason.NoEmail -> R.string.cn_lv_skip_no_email
            SkipReason.NoPhone -> R.string.cn_lv_skip_no_phone
            SkipReason.Other -> R.string.cn_lv_skip_other
        },
        item.number,
    )
