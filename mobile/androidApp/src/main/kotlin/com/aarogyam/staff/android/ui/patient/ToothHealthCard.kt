package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.visit.rememberMicStarter
import com.aarogyam.staff.chart.HealthLevel
import com.aarogyam.staff.chart.HealthSaveState
import com.aarogyam.staff.chart.TREAT_WITHIN_MONTHS
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.aarogyam.staff.chart.ToothStatusView
import com.aarogyam.staff.chart.ToothView
import com.aarogyam.staff.chart.suggestedHealth
import com.aarogyam.staff.device.DictationLanguage
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * The tooth's health: Healthy, Watch or Needs treatment. Without the doctor's status the chart's
 * suggestion is picked and says so; one tap saves a status (no visit needed). Watch and Needs
 * treatment take a "treat within" time; a one-line note saves itself.
 */
@Composable
internal fun ToothHealthCard(
    sheet: ToothSheetStateHolder,
    tooth: ToothView,
    status: ToothStatusView?,
    canRecord: Boolean,
    /** The person's voice-notes language; the chips beside the mic change it for this note. */
    voice: DictationLanguage,
    /** Start dictating into the note at once (a long press on the tooth). */
    dictate: Boolean = false,
) {
    val save by sheet.health.collectAsStateWithLifecycle()
    val suggested = tooth.suggestedHealth
    val level = status?.level ?: suggested
    var language by remember(tooth.number) { mutableStateOf(voice) }
    val listen = rememberMicStarter({ sheet.dictateHealthNote(tooth.number, it) })
    LaunchedEffect(tooth.number) {
        sheet.openTooth(tooth.number)
        if (dictate && canRecord) listen(language)
    }
    val levels = HealthLevel.entries.associateWith { healthLabel(it) }
    val spans = TREAT_WITHIN_MONTHS.associateWith { months(it) }
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (canRecord) {
                NoteEditor(sheet, tooth.number, save, status, language, { language = it }, listen)
            } else {
                status?.note?.let { V7Muted(it) }
            }
            V7Label(stringResource(R.string.pv_tooth_health))
            if (canRecord) {
                SkChoiceChips(
                    options = HealthLevel.entries,
                    selected = setOfNotNull(level),
                    onToggle = { picked ->
                        if (picked != status?.level) {
                            sheet.setHealth(tooth.number, picked, status?.treatWithinMonths, status?.note)
                        }
                    },
                    label = { levels.getValue(it) },
                )
            } else {
                Text(
                    level?.let { levels.getValue(it) } ?: stringResource(R.string.pv_tooth_health_unassessed),
                    style = v7(14f, FontWeight.Bold),
                    color = SkTheme.palette.onSurface.color,
                )
            }
            when {
                status == null && suggested != null -> V7Muted(stringResource(R.string.pv_tooth_health_suggested))
                status == null -> V7Muted(stringResource(R.string.pv_tooth_health_unassessed))
            }
            if (status != null && status.level.advisesTreatment) {
                V7Label(stringResource(R.string.pv_tooth_health_within))
                if (canRecord) {
                    SkChoiceChips(
                        options = TREAT_WITHIN_MONTHS,
                        selected = setOfNotNull(status.treatWithinMonths),
                        onToggle = { months ->
                            val next = months.takeIf { it != status.treatWithinMonths }
                            sheet.setHealth(tooth.number, status.level, next, status.note)
                        },
                        label = { spans.getValue(it) },
                    )
                } else {
                    status.treatWithinMonths?.let { V7Muted(spans[it] ?: months(it)) }
                }
            }
            if (canRecord && status != null) ResetLink { sheet.clearHealth(tooth.number) }
            if (save.error != null) {
                Text(
                    stringResource(R.string.pv_tooth_health_failed),
                    style = v7(12.5f),
                    color = SkTheme.palette.error.color,
                )
            }
        }
    }
}

/** The one-line note: typed, or dictated in the chosen language; saved by itself when typing pauses. */
@Composable
private fun NoteEditor(
    sheet: ToothSheetStateHolder,
    tooth: Int,
    save: HealthSaveState,
    status: ToothStatusView?,
    language: DictationLanguage,
    onLanguage: (DictationLanguage) -> Unit,
    listen: (DictationLanguage) -> Unit,
) {
    val listening = save.listening != null
    SkField(stringResource(R.string.pv_tooth_health_note), save.note, { sheet.editHealthNote(tooth, it) })
    save.live?.let { V7Muted(it) }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SkPillButton(
            stringResource(if (listening) R.string.pv_tooth_note_stop else R.string.pv_tooth_note_dictate),
            { if (listening) sheet.stopHealthDictation() else listen(language) },
        )
        SkChoiceChips(
            options = DictationLanguage.entries,
            selected = setOf(save.listening ?: language),
            onToggle = { if (!listening) onLanguage(it) },
            label = { it.shortCode() },
        )
    }
    if (save.noteSaved) V7Muted(stringResource(R.string.pv_tooth_health_note_saved))
}

/** EN, HI, MR or GU: the short switch beside the tooth note's mic. */
private fun DictationLanguage.shortCode(): String = tag.substringBefore('-').uppercase()

@Composable
private fun ResetLink(onClick: () -> Unit) {
    Box(
        Modifier.defaultMinSize(minHeight = 40.dp).clickable(role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            stringResource(R.string.pv_tooth_health_reset),
            style = v7(12.5f, FontWeight.Bold),
            color = SkTheme.palette.primary.color,
        )
    }
}

@Composable
private fun months(count: Int): String = pluralStringResource(R.plurals.pv_tooth_health_months, count, count)

@Composable
internal fun healthLabel(level: HealthLevel): String =
    stringResource(
        when (level) {
            HealthLevel.Healthy -> R.string.pv_tooth_health_healthy
            HealthLevel.Watch -> R.string.pv_tooth_health_watch
            HealthLevel.NeedsTreatment -> R.string.pv_tooth_health_needs
        },
    )
