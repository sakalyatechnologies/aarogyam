package com.aarogyam.staff.android.ui.labs

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.ChoiceChips
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.android.ui.clinical.DatePickDialog
import com.aarogyam.staff.android.ui.clinical.openLink
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.labs.ContactChannel
import com.aarogyam.staff.labs.ContactOutcome
import com.aarogyam.staff.labs.LabCase
import com.aarogyam.staff.labs.LabStatus
import com.aarogyam.staff.labs.LabsState
import com.aarogyam.staff.labs.LabsStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * One lab case: tracker, details, Call and WhatsApp (the text carries the case number, never a patient name),
 * Remind, Mark received and the contact log. Writes need `labs.write`.
 */
@Composable
fun LabCaseSheet(
    holder: LabsStateHolder,
    caseId: String,
    state: LabsState,
    zone: String,
    onDismiss: () -> Unit,
) {
    val item = state.cases.firstOrNull { it.id == caseId }
    SkBottomSheet(
        title = item?.titleText() ?: stringResource(R.string.cn_pv_labs_title),
        subtitle = item?.let { it.patientName + " · " + it.patientNumber },
        onDismiss = onDismiss,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = Spacing.L.dp, vertical = Spacing.M.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        ) {
            if (item == null) {
                Text(
                    stringResource(R.string.cn_pv_labs_none),
                    style = SkTypography.bodyText,
                    color = SkTheme.colors.textMuted.color,
                )
            } else {
                CaseBody(holder, item, state, zone)
            }
        }
    }
}

@Composable
private fun CaseBody(
    holder: LabsStateHolder,
    item: LabCase,
    state: LabsState,
    zone: String,
) {
    val colors = SkTheme.colors
    val context = LocalContext.current
    var logging by remember { mutableStateOf(false) }
    StatusPill(item.status, ClinicalFormat.isOverdue(item.dueOn, ClinicalFormat.today(zone)))
    SkCard { LabTracker(item.tracker?.ordinal) }
    SkCard {
        Text(item.detailText(), style = SkTypography.bodyText, color = colors.text.color)
        item.contactName?.let { Text(it, style = SkTypography.footnote, color = colors.textMuted.color) }
        item.lastContactedAt?.let { last ->
            ClinicalFormat.dateOfInstant(last, zone)?.let {
                Text(
                    stringResource(R.string.cn_pv_lab_last_contact, it),
                    style = SkTypography.footnote,
                    color = colors.textMuted.color,
                )
            }
        }
    }
    state.error?.let {
        Text(
            stringResource(it.message()),
            style = SkTypography.footnote,
            color = colors.dangerText.color,
        )
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        ClinicalFormat.tel(item.phone)?.let { tel ->
            SkButton(stringResource(R.string.cn_pv_action_call), {
                context.openLink(tel, dial = true)
            }, Modifier.weight(1f), SkButtonVariant.Secondary)
        }
        val text = waText(item)
        ClinicalFormat.whatsApp(item.phone, text)?.let { wa ->
            SkButton(stringResource(R.string.cn_pv_action_whatsapp), {
                context.openLink(wa)
            }, Modifier.weight(1f), SkButtonVariant.Secondary)
        }
    }
    if (state.canWrite) {
        val busy = state.busy == item.id
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            SkButton(
                stringResource(R.string.cn_pv_lab_log),
                { logging = !logging },
                Modifier.weight(1f),
                SkButtonVariant.Secondary,
            )
            SkButton(stringResource(R.string.cn_pv_lab_remind), {
                holder.remind(item.id)
            }, Modifier.weight(1f), SkButtonVariant.Secondary, enabled = !busy)
        }
        if (item.status.open) {
            SkButton(stringResource(R.string.cn_pv_lab_received), {
                holder.move(item.id, LabStatus.Received)
            }, Modifier.fillMaxWidth(), enabled = !busy)
        }
        if (logging) ContactLogForm(holder, item, zone, busy) { logging = false }
    }
}

/** The WhatsApp text to a lab: the case number and the work, never the patient's name. */
@Composable
private fun waText(item: LabCase): String =
    if (item.work.isEmpty()) {
        stringResource(R.string.cn_pv_lab_wa_plain, item.number)
    } else {
        stringResource(R.string.cn_pv_lab_wa_work, item.number, item.work.joinToString(", "))
    }

@Composable
private fun ContactLogForm(
    holder: LabsStateHolder,
    item: LabCase,
    zone: String,
    busy: Boolean,
    onSaved: () -> Unit,
) {
    var channel by remember { mutableStateOf(ContactChannel.Call) }
    var outcome by remember { mutableStateOf<ContactOutcome?>(null) }
    var promised by remember { mutableStateOf<String?>(null) }
    var picking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf("") }
    SectionLabel(stringResource(R.string.cn_pv_lab_channel))
    ChoiceChips(ContactChannel.entries, { it == channel }, { stringResource(channelTitle(it)) }, { channel = it })
    SectionLabel(stringResource(R.string.cn_pv_lab_outcome))
    ChoiceChips(ContactOutcome.entries, { it == outcome }, { stringResource(outcomeTitle(it)) }, {
        outcome =
            if (outcome == it) null else it
    })
    if (outcome == ContactOutcome.PromisedDate) {
        SkButton(
            stringResource(R.string.cn_pv_lab_promised) + (promised?.let { ": " + ClinicalFormat.date(it) } ?: ""),
            { picking = true },
            Modifier.fillMaxWidth(),
            SkButtonVariant.Secondary,
        )
    }
    if (picking) DatePickDialog(onPicked = { promised = it }, onDismiss = { picking = false })
    SkTextField(note, { note = it }, stringResource(R.string.cn_pv_form_note))
    SkButton(stringResource(R.string.cn_pv_lab_save_log), {
        val day = if (outcome == ContactOutcome.PromisedDate) promised ?: ClinicalFormat.today(zone) else null
        holder.logContact(item.id, channel, outcome, note.ifBlank { null }, day)
        onSaved()
    }, Modifier.fillMaxWidth(), enabled = !busy)
}

private fun channelTitle(channel: ContactChannel): Int =
    when (channel) {
        ContactChannel.Call -> R.string.cn_pv_lab_channel_call
        ContactChannel.WhatsApp -> R.string.cn_pv_lab_channel_whatsapp
        ContactChannel.Email -> R.string.cn_pv_lab_channel_email
        ContactChannel.Visit -> R.string.cn_pv_lab_channel_visit
    }

private fun outcomeTitle(outcome: ContactOutcome): Int =
    when (outcome) {
        ContactOutcome.Reached -> R.string.cn_pv_lab_outcome_reached
        ContactOutcome.NoAnswer -> R.string.cn_pv_lab_outcome_no_answer
        ContactOutcome.PromisedDate -> R.string.cn_pv_lab_outcome_promised
        ContactOutcome.Other -> R.string.cn_pv_lab_outcome_other
    }
