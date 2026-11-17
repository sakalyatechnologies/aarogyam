package com.aarogyam.staff.android.ui.labs

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BarAction
import com.aarogyam.staff.android.ui.StatusBarTone
import com.aarogyam.staff.android.ui.clinical.ChoiceChips
import com.aarogyam.staff.android.ui.clinical.ClinicalFormat
import com.aarogyam.staff.android.ui.clinical.openLink
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.labs.LabsStateHolder
import com.aarogyam.staff.labs.ReminderChannel
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTabs
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Lab work: cases (with an overdue filter and Remind all) and the lab directory, on the shared `LabsStateHolder`. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LabsScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    holder: LabsStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val context: Context = LocalContext.current
    var page by rememberSaveable { mutableIntStateOf(0) }
    var openCase by rememberSaveable { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    LaunchedEffect(state.waLink) {
        val link = state.waLink ?: return@LaunchedEffect
        ClinicalFormat.whatsAppLink(link)?.let(context::openLink)
        holder.waLinkOpened()
    }
    val today = ClinicalFormat.today(clinic.session.clinic.timezone)
    Column(Modifier.fillMaxSize()) {
        StatusBarTone.DarkHeader()
        SkTopBar(
            title = stringResource(R.string.cn_pv_labs_title),
            navigation = { BarAction(stringResource(R.string.back), SkTheme.colors.onBrandDark.color, onBack) },
            actions = {
                if (state.canWrite) {
                    BarAction(stringResource(R.string.cn_pv_labs_new), SkTheme.colors.onBrandDark.color, {
                        creating =
                            true
                    })
                }
            },
        )
        if (!state.allowed) {
            SkEmptyState(stringResource(R.string.cn_pv_labs_title), stringResource(R.string.cn_pv_labs_not_allowed))
        } else {
            SkTabs(
                listOf(
                    stringResource(R.string.cn_pv_labs_cases),
                    stringResource(R.string.cn_pv_labs_directory),
                ),
                page,
                {
                    page =
                        it
                },
            )
            PullToRefreshBox(
                isRefreshing = state.loading,
                onRefresh = holder::refresh,
                modifier = Modifier.weight(1f),
            ) {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(Spacing.ML.dp),
                    verticalArrangement = Arrangement.spacedBy(if (page == 0) 3.dp else Spacing.SM.dp),
                ) {
                    state.error?.let {
                        item {
                            Text(
                                stringResource(it.message()),
                                style = SkTypography.footnote,
                                color = SkTheme.colors.dangerText.color,
                            )
                        }
                    }
                    if (page == 0) {
                        caseItems(state, today, holder, onOpen = { openCase = it }, onRemind = { confirming = true })
                    } else {
                        directoryItems(state.labs, context)
                    }
                }
            }
        }
    }
    if (confirming) RemindAllDialog(holder, onDismiss = { confirming = false })
    openCase?.let { LabCaseSheet(holder, it, state, clinic.session.clinic.timezone, onDismiss = { openCase = null }) }
    if (creating) {
        NewLabCaseFlow(
            graph,
            clinic,
            state.labs,
            onCreated = holder::refresh,
            onDismiss = { creating = false },
        )
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.caseItems(
    state: com.aarogyam.staff.labs.LabsState,
    today: String,
    holder: LabsStateHolder,
    onOpen: (String) -> Unit,
    onRemind: () -> Unit,
) {
    item {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            ChoiceChips(
                listOf(false, true),
                selected = { it == state.overdueOnly },
                label = {
                    if (it) {
                        stringResource(
                            R.string.cn_pv_labs_overdue,
                        )
                    } else {
                        stringResource(R.string.cn_pv_labs_all)
                    }
                },
                onPick = holder::showOverdue,
            )
            if (state.canWrite && state.overdueOnly && state.cases.isNotEmpty()) {
                SkButton(
                    stringResource(R.string.cn_lv_remind_all, state.cases.size),
                    onClick = onRemind,
                    variant = SkButtonVariant.Secondary,
                    enabled = !state.remindingAll,
                    modifier = Modifier.fillMaxSizeWidth(),
                )
            }
            state.reminderResult?.let { RemindResultCard(it, holder::reminderResultSeen) }
        }
    }
    if (state.cases.isEmpty() && !state.loading) {
        item {
            SkCard {
                Text(
                    stringResource(
                        if (state.overdueOnly) R.string.cn_pv_labs_none_overdue else R.string.cn_pv_labs_none,
                    ),
                    style = SkTypography.bodyText,
                    color = SkTheme.colors.textMuted.color,
                )
            }
        }
    }
    items(state.cases, key = {
        it.id
    }) { item -> LabCaseRow(item, ClinicalFormat.isOverdue(item.dueOn, today)) { onOpen(item.id) } }
}

private fun Modifier.fillMaxSizeWidth(): Modifier = this.then(Modifier.fillMaxWidth())

/** Remind all: choose Email or WhatsApp. */
@Composable
private fun RemindAllDialog(
    holder: LabsStateHolder,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.cn_lv_remind_all_title)) },
        text = { Text(stringResource(R.string.cn_lv_remind_all_message)) },
        confirmButton = {
            Column {
                TextButton(onClick = {
                    holder.remindOverdue(ReminderChannel.Email)
                    onDismiss()
                }) { Text(stringResource(R.string.cn_lv_remind_all_email)) }
                TextButton(onClick = {
                    holder.remindOverdue(ReminderChannel.WhatsApp)
                    onDismiss()
                }) { Text(stringResource(R.string.cn_lv_remind_all_whatsapp)) }
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cn_lv_cancel)) } },
    )
}
