package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.consents.ConsentMethod
import com.aarogyam.staff.consents.ConsentPurpose
import com.aarogyam.staff.consents.ConsentView
import com.aarogyam.staff.consents.ConsentsState
import com.aarogyam.staff.consents.ConsentsStateHolder
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

@Composable
internal fun ConsentPurpose.title(): String =
    stringResource(
        when (this) {
            ConsentPurpose.Care -> R.string.p9_consent_purpose_care
            ConsentPurpose.Reminders -> R.string.p9_consent_purpose_reminders
            ConsentPurpose.Promotional -> R.string.p9_consent_purpose_promotional
            ConsentPurpose.Sharing -> R.string.p9_consent_purpose_sharing
            ConsentPurpose.Research -> R.string.p9_consent_purpose_research
        },
    )

@Composable
internal fun ConsentMethod.title(): String =
    stringResource(
        when (this) {
            ConsentMethod.Paper -> R.string.p9_consent_method_paper
            ConsentMethod.Verbal -> R.string.p9_consent_method_verbal
            ConsentMethod.App -> R.string.p9_consent_method_app
        },
    )

@Composable
private fun ConsentView.purposeTitle(): String = purpose?.title() ?: purposeKey.replaceFirstChar { it.uppercase() }

/** `Given 5 Oct 2026, signed on paper · notice v2`, or the withdrawn form. */
@Composable
private fun ConsentView.detailLine(): String {
    val notice = stringResource(R.string.p9_consent_notice, noticeVersion)
    val off = withdrawnAt
    if (off !=
        null
    ) {
        return listOf(
            stringResource(R.string.p9_consent_withdrawn_on, off.date.display()),
            notice,
        ).joinToString(" · ")
    }
    val given = givenAt?.date?.display().orEmpty()
    val how = method?.let { ", " + it.title().lowercase() }.orEmpty()
    return listOf(stringResource(R.string.p9_consent_given_on, given) + how, notice).joinToString(" · ")
}

/** The Consent tab: given consents with Withdraw, withdrawn ones, and Record a consent. */
@Composable
internal fun ConsentTab(holder: ConsentsStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    val title = stringResource(R.string.p9_tab_consent)
    when (val current = state) {
        ConsentsState.Loading -> SectionState(title, SectionKind.Loading)
        ConsentsState.NotAllowed -> SectionState(title, SectionKind.NotAllowed)
        is ConsentsState.Failed -> SectionState(title, SectionKind.Failed(current.error), holder::refresh)
        is ConsentsState.Loaded -> Content(holder, current)
    }
}

@Composable
private fun Content(
    holder: ConsentsStateHolder,
    loaded: ConsentsState.Loaded,
) {
    var recording by remember { mutableStateOf(false) }
    var withdrawing by remember { mutableStateOf<ConsentView?>(null) }
    val forms by holder.forms.state.collectAsStateWithLifecycle()
    SignedFormEffect(holder.forms, forms)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!recording) loaded.error?.let { ErrorLine(it) }
        if (forms.error != null) {
            Text(
                stringResource(R.string.p9_consent_form_failed),
                style = v7(12.5f),
                color = SkTheme.palette.error.color,
            )
        }
        V7Card {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SectionHead(
                    stringResource(R.string.p9_consent_title),
                    stringResource(R.string.p9_consent_given_count, loaded.active.size),
                )
                if (loaded.active.isEmpty()) {
                    V7Muted(
                        stringResource(R.string.p9_consent_none),
                        Modifier.padding(vertical = 6.dp),
                    )
                }
                loaded.active.forEach { consent ->
                    ConsentRow(consent, true, loaded.canWithdraw) { withdrawing = consent }
                    SignedFormLink(consent, holder.forms, forms, loaded.canRecord)
                }
            }
        }
        if (loaded.withdrawn.isNotEmpty()) {
            V7Card {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SectionHead(stringResource(R.string.p9_consent_withdrawn), loaded.withdrawn.size.toString())
                    loaded.withdrawn.forEach { ConsentRow(it, false, false) {} }
                }
            }
        }
        if (loaded.canRecord) {
            SkPillButton(
                stringResource(R.string.p9_consent_record),
                {
                    holder.clearError()
                    recording = true
                },
                variant = SkPillVariant.Tonal,
                icon = PatientIcons.of("plus"),
                wide = true,
            )
        }
    }
    if (recording) RecordConsentSheet(holder, loaded) { recording = false }
    withdrawing?.let { consent -> WithdrawDialog(consent, holder) { withdrawing = null } }
}

@Composable
private fun WithdrawDialog(
    consent: ConsentView,
    holder: ConsentsStateHolder,
    onClose: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(stringResource(R.string.p9_consent_withdraw_q, consent.purposeTitle())) },
        text = {
            Column {
                Text(stringResource(R.string.p9_consent_withdraw_msg, consent.noticeVersion))
                TextButton({
                    holder.withdraw(consent.id, ConsentMethod.Verbal, null)
                    onClose()
                }) {
                    Text(stringResource(R.string.p9_consent_withdraw_verbal), color = SkTheme.palette.error.color)
                }
                TextButton({
                    holder.withdraw(consent.id, ConsentMethod.Paper, null)
                    onClose()
                }) {
                    Text(stringResource(R.string.p9_consent_withdraw_paper), color = SkTheme.palette.error.color)
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClose) { Text(stringResource(R.string.p9_cancel)) } },
    )
}

@Composable
private fun ConsentRow(
    consent: ConsentView,
    active: Boolean,
    canWithdraw: Boolean,
    onWithdraw: () -> Unit,
) {
    val p = SkTheme.palette
    val title = consent.purposeTitle()
    Row(
        Modifier.padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(38.dp).background((if (active) p.primaryContainer else p.surface3).color, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            V7Icon(
                if (active) "check" else "lock_fill",
                (if (active) p.onPrimaryContainer else p.onSurfaceVariant).color,
                18.dp,
            )
        }
        Column(
            Modifier.weight(1f).semantics(mergeDescendants = true) {},
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            Text(title, style = v7(14f, FontWeight.Bold), color = p.onSurface.color)
            Text(consent.detailLine(), style = v7(12f), color = p.onSurfaceVariant.color)
        }
        if (!active) {
            V7Pill(stringResource(R.string.p9_consent_off), PillKind.Neutral)
        } else if (canWithdraw) {
            val description = stringResource(R.string.p9_consent_withdraw_a11y, title)
            Box(
                Modifier
                    .defaultMinSize(minHeight = 44.dp)
                    .background(p.surface2.color, CircleShape)
                    .clickable(role = Role.Button, onClick = onWithdraw)
                    .padding(horizontal = 12.dp)
                    .semantics { contentDescription = description },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    stringResource(R.string.p9_consent_withdraw),
                    style = v7(12f, FontWeight.Bold),
                    color = p.primary.color,
                )
            }
        }
    }
}
