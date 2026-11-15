package com.aarogyam.staff.android.ui.labs

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.android.ui.clinical.openLink
import com.aarogyam.staff.labs.LabRow
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The directory: each lab with its vendor line and the people there, each a tap from a call or a WhatsApp message. */
fun LazyListScope.directoryItems(
    labs: List<LabRow>,
    context: Context,
) {
    if (labs.isEmpty()) {
        item {
            SkCard {
                Text(
                    stringResource(R.string.cn_pv_labs_no_labs),
                    style = SkTypography.bodyText,
                    color = SkTheme.colors.textMuted.color,
                )
            }
        }
    }
    items(labs, key = { it.id }) { lab ->
        val colors = SkTheme.colors
        val hello = stringResource(R.string.cn_pv_lab_wa_hello)
        SkCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(lab.name, style = SkTypography.bodyStrong, color = colors.text.color)
                        val line = lab.infoLine()
                        if (line.isNotEmpty()) Text(line, style = SkTypography.footnote, color = colors.textMuted.color)
                    }
                    CallButton(lab.phone, context)
                }
                lab.contacts.forEach { person ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(person.name, style = SkTypography.bodyText, color = colors.text.color)
                            person.phone?.let { Text(it, style = SkTypography.caption, color = colors.textMuted.color) }
                        }
                        if (person.whatsapp) {
                            ClinicalFormat.whatsApp(person.phone, hello)?.let { link ->
                                LinkText(stringResource(R.string.cn_pv_action_whatsapp)) { context.openLink(link) }
                            }
                        }
                        CallButton(person.phone, context)
                    }
                }
            }
        }
    }
}

@Composable
private fun CallButton(
    phone: String?,
    context: Context,
) {
    ClinicalFormat.tel(phone)?.let { tel ->
        LinkText(stringResource(R.string.cn_pv_action_call)) { context.openLink(tel, dial = true) }
    }
}

@Composable
private fun LinkText(
    text: String,
    onClick: () -> Unit,
) {
    Text(
        text,
        style = SkTypography.label,
        color = SkTheme.colors.primaryText.color,
        modifier =
            Modifier
                .heightIn(min = Spacing.MIN_TOUCH_TARGET.dp)
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = 10.dp, vertical = 12.dp),
    )
}
