package com.aarogyam.staff.android.ui.visit

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.RxCheckBanner
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.prescriptions.DraftSave
import com.aarogyam.staff.prescriptions.DrugView
import com.aarogyam.staff.prescriptions.RxPhase
import com.aarogyam.staff.prescriptions.RxSetChip
import com.aarogyam.staff.prescriptions.RxSheetState
import com.aarogyam.staff.prescriptions.RxSheetStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkSearchField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * Write prescription, inline: a card that grows in place with drug search, one card per medicine, the
 * allergy check, Save draft and Sign and issue; once signed it shows the delivery choices.
 */
@Composable
internal fun VisitRxCard(
    rx: RxSheetStateHolder,
    state: RxSheetState,
    phone: String?,
    canIssue: Boolean,
    open: Boolean,
    onOpen: (Boolean) -> Unit,
) {
    val colors = SkTheme.colors
    val signed = state.phase == RxPhase.Issued
    val shape = RoundedCornerShape(Spacing.XXL.dp)
    val title = stringResource(if (signed) R.string.vv_v9v_rx_title_signed else R.string.vv_v9v_rx_title)
    val subtitle = subtitle(state, canIssue, signed)
    val hint = stringResource(if (open) R.string.vv_v9v_rx_collapse_a11y else R.string.vv_v9v_rx_expand_a11y)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(colors.card.color)
            .then(if (open) Modifier.border(2.dp, colors.primary.color, shape) else Modifier),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = HEADER.dp)
                .clickable(role = Role.Button) { onOpen(!open) }
                .padding(Spacing.L.dp)
                .semantics { contentDescription = "$title, $subtitle. $hint" },
            horizontalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(title, style = SkTypography.headline, color = colors.text.color)
                Muted(subtitle)
            }
            Text(if (open) "−" else "+", style = SkTypography.title, color = colors.text.color)
        }
        if (open) {
            Column(
                Modifier.padding(start = Spacing.L.dp, end = Spacing.L.dp, bottom = Spacing.L.dp),
                verticalArrangement = Arrangement.spacedBy(Spacing.M.dp),
            ) {
                when {
                    !canIssue || !state.allowed -> Muted(stringResource(R.string.vv_v9v_rx_not_allowed))
                    signed -> Signed(rx, state, phone) { onOpen(false) }
                    else -> Composer(rx, state) { onOpen(false) }
                }
            }
        }
    }
}

@Composable
private fun subtitle(
    state: RxSheetState,
    canIssue: Boolean,
    signed: Boolean,
): String =
    when {
        !canIssue || !state.allowed -> {
            stringResource(R.string.vv_v9v_rx_not_allowed_short)
        }

        signed -> {
            state.issued?.number?.let { stringResource(R.string.vv_v9v_rx_signed_sub, it) }
                ?: stringResource(R.string.vv_v9v_rx_signed_plain)
        }

        state.lines.isEmpty() -> {
            stringResource(R.string.vv_v9v_rx_hint)
        }

        else -> {
            stringResource(
                R.string.vv_v9v_rx_sub_count,
                state.lines.size,
                stringResource(
                    if (state.draft ==
                        DraftSave.Saved
                    ) {
                        R.string.vv_v9v_rx_draft_kept
                    } else {
                        R.string.vv_v9v_rx_draft
                    },
                ),
            )
        }
    }

@Composable
private fun Composer(
    rx: RxSheetStateHolder,
    state: RxSheetState,
    onDraftKept: () -> Unit,
) {
    val locked = state.phase == RxPhase.Issuing
    SkSearchField(state.query, rx::search, stringResource(R.string.vv_v9v_rx_search))
    when {
        state.searching -> {
            Muted(stringResource(R.string.vv_v9v_rx_searching))
        }

        state.results.isNotEmpty() -> {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
            ) {
                state.results.forEach { drug -> Suggestion(drug) { rx.add(drug) } }
            }
        }

        state.query.isNotBlank() -> {
            Muted(stringResource(R.string.vv_v9v_rx_no_match))
        }
    }
    if (state.sets.isNotEmpty() && state.query.isEmpty() && !state.searching) SetChips(rx, state.sets, locked)
    if (state.lines.isEmpty() && state.results.isEmpty() && state.query.isEmpty()) {
        SkButton(
            stringResource(R.string.rx_quick),
            onClick = rx::quickRx,
            variant = SkButtonVariant.Secondary,
            modifier = Modifier.fillMaxWidth(),
        )
        Muted(stringResource(R.string.vv_v9v_rx_how))
    }
    state.lines.forEach { line ->
        MedCard(rx, line, state.warnings.any { it.lineKey == line.key }, !locked, state.alternatives)
    }
    RxCheckBanner(state)
    if (state.needsOverride) AllergyCard(rx, state)
    state.error?.let { ErrorLine(stringResource(it.message())) }
    if (state.lines.isNotEmpty()) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            SkButton(
                stringResource(
                    if (state.draft ==
                        DraftSave.Saved
                    ) {
                        R.string.vv_v9v_rx_draft_saved
                    } else {
                        R.string.vv_v9v_rx_save_draft
                    },
                ),
                onClick = {
                    rx.saveDraft()
                    onDraftKept()
                },
                variant = SkButtonVariant.Secondary,
                enabled = !locked,
                modifier = Modifier.weight(1f),
            )
            SkButton(
                stringResource(if (locked) R.string.rx_issuing else R.string.vv_v9v_rx_sign),
                onClick = rx::issue,
                enabled = state.canIssue,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun Suggestion(
    drug: DrugView,
    onAdd: () -> Unit,
) {
    WellChip(
        "+ ${drug.name} ${drug.strength}".trim(),
        stringResource(R.string.vv_v9v_rx_add_a11y, drug.name),
        onClick = onAdd,
    )
}

@Composable
private fun SetChips(
    rx: RxSheetStateHolder,
    sets: List<RxSetChip>,
    locked: Boolean,
) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        sets.forEach { set ->
            WellChip(
                "+ ${set.label} ${set.count}",
                stringResource(R.string.vv_v9v_rx_set_a11y, set.label, set.count),
                enabled = !locked,
            ) {
                rx.addSet(set.id)
            }
        }
    }
}

@Composable
private fun Signed(
    rx: RxSheetStateHolder,
    state: RxSheetState,
    phone: String?,
    onDone: () -> Unit,
) {
    val colors = SkTheme.colors
    state.lines.forEach { line ->
        Column(
            Modifier
                .fillMaxWidth()
                .clip(
                    RoundedCornerShape(Spacing.L.dp),
                ).background(colors.inset.color)
                .padding(Spacing.ML.dp),
        ) {
            Text(line.name, style = SkTypography.bodyStrong, color = colors.text.color)
            Muted(totalText(VisitDose.total(line.frequency, line.durationDays, line.detail)))
        }
    }
    val by =
        state.issued?.number?.let { stringResource(R.string.vv_v9v_rx_signed_by, it) }
            ?: stringResource(R.string.vv_v9v_rx_signed_plain)
    Text("✓ $by", style = SkTypography.bodyStrong, color = colors.primaryText.color)
    RxDelivery(rx, state, phone, onDone)
}

private const val HEADER = 72
