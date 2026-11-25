package com.aarogyam.staff.android.ui.visit

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.RxAlternativesPanel
import com.aarogyam.staff.android.ui.label
import com.aarogyam.staff.prescriptions.AllergyWarning
import com.aarogyam.staff.prescriptions.AlternativesState
import com.aarogyam.staff.prescriptions.DoseSlot
import com.aarogyam.staff.prescriptions.RxLine
import com.aarogyam.staff.prescriptions.RxSheetState
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.aarogyam.staff.prescriptions.RxTiming
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

@StringRes
private fun RxTiming.label(): Int? =
    when (this) {
        RxTiming.BeforeFood -> R.string.vv_v9v_timing_before_food
        RxTiming.AfterFood -> R.string.vv_v9v_timing_after_food
        RxTiming.EmptyStomach -> R.string.vv_v9v_timing_empty_stomach
        RxTiming.Bedtime -> R.string.vv_v9v_timing_bedtime
        RxTiming.Sos -> R.string.vv_v9v_timing_sos
        RxTiming.AsDirected -> null
    }

@StringRes
private fun DoseSlot.label(): Int =
    when (this) {
        DoseSlot.Morning -> R.string.vv_v9v_dose_morning
        DoseSlot.Afternoon -> R.string.vv_v9v_dose_afternoon
        DoseSlot.Night -> R.string.vv_v9v_dose_night
    }

/** `1-0-1 · 10 tablets`; just the frequency when no count can be given, and "up to" for SOS. */
@Composable
internal fun totalText(total: DoseTotal): String {
    val count = total.count ?: return total.frequency
    val unit =
        stringResource(
            when {
                total.capsule && count == 1 -> R.string.vv_v9v_rx_unit_capsule
                total.capsule -> R.string.vv_v9v_rx_unit_capsules
                count == 1 -> R.string.vv_v9v_rx_unit_tablet
                else -> R.string.vv_v9v_rx_unit_tablets
            },
        )
    val amount = stringResource(R.string.vv_v9v_rx_total, count, unit)
    return "${total.frequency} · ${if (total.sos) stringResource(R.string.vv_v9v_rx_up_to, amount) else amount}"
}

/** One medicine: name, three dose cells that cycle on tap, timing, days and the total. */
@Composable
internal fun MedCard(
    rx: RxSheetStateHolder,
    line: RxLine,
    warned: Boolean,
    editable: Boolean,
    alternatives: AlternativesState? = null,
) {
    val colors = SkTheme.colors
    val shape = RoundedCornerShape(Spacing.XL.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.inset.color)
            .then(if (warned) Modifier.border(2.dp, colors.danger.color, shape) else Modifier)
            .padding(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(line.name, style = SkTypography.bodyStrong, color = colors.text.color)
                if (line.detail.isNotBlank()) Muted(line.detail)
                line.instructions?.let {
                    Text(
                        it,
                        style = SkTypography.footnote.copy(fontStyle = FontStyle.Italic),
                        color = colors.textMuted.color,
                    )
                }
            }
            if (editable) RoundGlyph("×", stringResource(R.string.rx_remove, line.name)) { rx.remove(line.key) }
        }
        if (editable && line.drugId != null) {
            val shown = alternatives?.lineKey == line.key
            VisitChip(stringResource(R.string.rx_alt_action), shown) {
                if (shown) rx.closeAlternatives() else rx.openAlternatives(line.key)
            }
            if (alternatives != null && shown) RxAlternativesPanel(alternatives) { rx.swapDrug(line.key, it) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
            VisitDose.slots.forEach { slot ->
                DoseCell(Modifier.weight(1f), line, slot, editable) {
                    rx.setFrequency(line.key, VisitDose.cycled(line.frequency, slot))
                }
            }
        }
        Muted(stringResource(R.string.vv_v9v_timing_label))
        Row(
            Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
        ) {
            RxTiming.entries.forEach { option ->
                val label = option.label() ?: return@forEach
                val on = line.timing == option.api
                VisitChip(stringResource(label), on, editable) { rx.setTiming(line.key, if (on) null else option) }
            }
        }
        val total =
            totalText(
                VisitDose.total(
                    line.frequency,
                    line.durationDays,
                    line.detail,
                    sos =
                        line.timing == RxTiming.Sos.api,
                ),
            )
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                RoundGlyph("−", stringResource(R.string.vv_v9v_days_fewer), editable) {
                    rx.setDuration(line.key, VisitDose.days(line.durationDays, -1))
                }
                Text(
                    pluralStringResource(R.plurals.rx_days, line.durationDays, line.durationDays),
                    style = SkTypography.bodyStrong,
                    color = colors.text.color,
                    modifier = Modifier.sizeIn(minWidth = DAYS_WIDTH.dp),
                    textAlign = TextAlign.Center,
                )
                RoundGlyph("+", stringResource(R.string.vv_v9v_days_more), editable) {
                    rx.setDuration(line.key, VisitDose.days(line.durationDays, 1))
                }
            }
            val spoken = stringResource(R.string.vv_v9v_rx_total_a11y, total)
            Text(
                total,
                style = SkTypography.bodyStrong,
                color = colors.primaryText.color,
                textAlign = TextAlign.End,
                modifier =
                    Modifier.weight(1f).semantics {
                        contentDescription =
                            spoken
                    },
            )
        }
    }
}

@Composable
private fun DoseCell(
    modifier: Modifier,
    line: RxLine,
    slot: DoseSlot,
    editable: Boolean,
    onTap: () -> Unit,
) {
    val colors = SkTheme.colors
    val halves = VisitDose.halves(line.frequency, slot)
    val shown = VisitDose.cell(halves)
    val name = stringResource(slot.label())
    val spoken = stringResource(R.string.vv_v9v_dose_a11y, name, shown)
    val on = halves > 0
    Column(
        modifier
            .heightIn(min = CELL.dp)
            .clip(RoundedCornerShape(Spacing.ML.dp))
            .background(if (on) colors.brandSoft.color else colors.card.color)
            .clickable(enabled = editable, role = Role.Button, onClick = onTap)
            .semantics { contentDescription = spoken },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            name,
            style = SkTypography.caption,
            color = if (on) colors.primaryText.color else colors.textMuted.color,
            maxLines = 1,
        )
        Text(
            shown,
            fontSize = CELL_TEXT.sp,
            fontWeight = FontWeight.ExtraBold,
            fontFamily = FontFamily.Monospace,
            color = if (on) colors.primaryText.color else colors.text.color,
        )
    }
}

/** The allergy card: what clashed, a way to take the medicine off and the reason to override. */
@Composable
internal fun AllergyCard(
    rx: RxSheetStateHolder,
    state: RxSheetState,
) {
    val colors = SkTheme.colors
    Column(
        Modifier
            .fillMaxWidth()
            .clip(
                RoundedCornerShape(Spacing.XL.dp),
            ).background(colors.dangerSoft.color)
            .padding(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
    ) {
        Text(
            stringResource(R.string.vv_c_rx_allergy_title),
            style = SkTypography.headline,
            color = colors.dangerText.color,
        )
        state.warnings.forEach { warning ->
            Text(warning.text(), style = SkTypography.footnote, color = colors.dangerText.color)
            SkButton(stringResource(R.string.vv_c_rx_allergy_remove, warning.drug), onClick = {
                rx.remove(warning.lineKey)
            }, variant = SkButtonVariant.Secondary, modifier = Modifier.fillMaxWidth())
            if (state.lines.any { it.key == warning.lineKey && it.drugId != null }) {
                val shown = state.alternatives?.lineKey == warning.lineKey
                SkButton(stringResource(R.string.rx_alt_action), onClick = {
                    if (shown) rx.closeAlternatives() else rx.openAlternatives(warning.lineKey)
                }, variant = SkButtonVariant.Secondary, modifier = Modifier.fillMaxWidth())
                state.alternatives?.takeIf { shown }?.let {
                    RxAlternativesPanel(
                        it,
                    ) { drug -> rx.swapDrug(warning.lineKey, drug) }
                }
            }
        }
        state.serverAlerts.forEach { Text(it.message, style = SkTypography.footnote, color = colors.dangerText.color) }
        if (state.serverAlert &&
            state.serverAlerts.isEmpty()
        ) {
            Text(
                stringResource(R.string.rx_server_alert),
                style = SkTypography.footnote,
                color = colors.dangerText.color,
            )
        }
        SkTextField(
            value = state.overrideReason,
            onValueChange = rx::setOverrideReason,
            label = stringResource(R.string.rx_override_label),
            supportingText = stringResource(R.string.rx_override_help),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun AllergyWarning.text(): String =
    stringResource(R.string.rx_allergy_warning, drug, substance, stringResource(severity.label()))

private const val DAYS_WIDTH = 64
private const val CELL = 62
private const val CELL_TEXT = 22
