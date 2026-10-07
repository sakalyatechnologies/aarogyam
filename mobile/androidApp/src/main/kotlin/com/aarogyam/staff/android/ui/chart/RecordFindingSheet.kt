package com.aarogyam.staff.android.ui.chart

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.EntryStatus
import com.aarogyam.staff.chart.Finding
import com.aarogyam.staff.chart.HistoryEntryView
import com.aarogyam.staff.chart.HistoryState
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.SurfaceFinding
import com.aarogyam.staff.chart.TermKind
import com.aarogyam.staff.chart.TermView
import com.aarogyam.staff.chart.ToothSelection
import com.aarogyam.staff.chart.ToothView
import com.aarogyam.staff.chart.hasLabel
import com.aarogyam.staff.chart.matchTerms
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The record sheet's answer: the finding, surfaces (empty for the whole tooth), procedure, material and remark. */
data class RecordedFinding(
    val finding: Finding,
    val surfaces: List<Surface>,
    val procedure: TermView?,
    val material: TermView?,
    val note: String,
)

/** What the sheet needs to offer and add procedures and materials. */
data class TermChoices(
    val terms: List<TermView>,
    val adding: Boolean,
    val added: TermView?,
    val error: ScreenError?,
    val onAdd: (TermKind, String) -> Unit,
    val onConsumed: () -> Unit,
)

/**
 * Records one finding on [teeth]: the whole tooth or chosen surfaces (whole-tooth findings lock
 * it to the whole tooth), with a procedure and material picked by type-ahead or added for the clinic.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RecordFindingSheet(
    teeth: List<ToothView>,
    initialSurface: Surface?,
    choices: TermChoices,
    onSave: (RecordedFinding) -> Unit,
    onDismiss: () -> Unit,
) {
    var finding by rememberSaveable { mutableStateOf(Finding.Caries) }
    var surfaces by rememberSaveable { mutableStateOf(listOfNotNull(initialSurface)) }
    var procedure by remember { mutableStateOf<TermView?>(null) }
    var material by remember { mutableStateOf<TermView?>(null) }
    var addingKind by remember { mutableStateOf<TermKind?>(null) }
    var note by rememberSaveable { mutableStateOf("") }
    val chosen = if (finding.wholeTooth) emptyList() else surfaces
    val one = teeth.singleOrNull()
    LaunchedEffect(choices.added) {
        val added = choices.added ?: return@LaunchedEffect
        if (added.kind == TermKind.Procedure) procedure = added else material = added
        addingKind = null
        choices.onConsumed()
    }
    val title =
        if (one != null) {
            stringResource(R.string.chart_record_title, one.number)
        } else {
            stringResource(R.string.chart_record_title_group, teeth.joinToString(", ") { it.number.toString() })
        }
    SkBottomSheet(title, onDismiss) {
        Caption(R.string.chart_finding)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.S.dp),
        ) {
            Finding.entries.forEach { f -> Pill(stringResource(f.label()), f == finding) { finding = f } }
        }
        Caption(R.string.chart_surfaces)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.S.dp),
        ) {
            Pill(stringResource(R.string.chart_whole_tooth), chosen.isEmpty()) { surfaces = emptyList() }
            Surface.entries.forEach { s ->
                val name =
                    if (one !=
                        null
                    ) {
                        stringResource(one.surfaceName(s).label())
                    } else {
                        stringResource(s.genericLabel())
                    }
                Pill(name, s in chosen, enabled = !finding.wholeTooth) {
                    surfaces = if (s in surfaces) surfaces - s else surfaces + s
                }
            }
        }
        if (finding != Finding.Sound) {
            Caption(R.string.chart_procedure)
            TermPicker(TermKind.Procedure, choices, procedure, { procedure = it }) {
                addingKind = TermKind.Procedure
                choices.onAdd(TermKind.Procedure, it)
            }
            Caption(R.string.chart_material)
            TermPicker(TermKind.Material, choices, material, { material = it }) {
                addingKind = TermKind.Material
                choices.onAdd(TermKind.Material, it)
            }
            choices.error?.let {
                Text(
                    stringResource(R.string.chart_term_failed, stringResource(it.message())),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
            }
        }
        SkTextField(note, {
            if (it.length <=
                NOTE_LIMIT
            ) {
                note = it
            }
        }, stringResource(R.string.chart_note), Modifier.padding(top = Spacing.M.dp))
        SkButton(
            stringResource(R.string.chart_save),
            { onSave(RecordedFinding(finding, chosen, procedure, material, note)) },
            enabled = addingKind == null || !choices.adding,
            modifier = Modifier.fillMaxWidth().padding(top = Spacing.L.dp),
        )
    }
}

/** Surface names for several teeth at once, front and back. */
private fun Surface.genericLabel(): Int =
    when (this) {
        Surface.M -> R.string.surface_mesial
        Surface.D -> R.string.surface_distal
        Surface.O -> R.string.surface_occlusal_incisal
        Surface.B -> R.string.surface_buccal_labial
        Surface.L -> R.string.surface_lingual_palatal
    }

/**
 * A procedure or material dropdown with type-ahead: the field filters the chart's list on the
 * phone ("Z" offers Zirconia), and "Add" saves a new term for the clinic.
 */
@Composable
private fun TermPicker(
    kind: TermKind,
    choices: TermChoices,
    value: TermView?,
    onPick: (TermView?) -> Unit,
    onAdd: (String) -> Unit,
) {
    var text by remember(value) { mutableStateOf(value?.label.orEmpty()) }
    val typing = text.trim() != value?.label.orEmpty()
    val colors = SkTheme.colors
    SkTextField(
        text,
        {
            text = it
            if (it.isBlank()) onPick(null)
        },
        stringResource(if (kind == TermKind.Material) R.string.chart_material else R.string.chart_procedure),
        placeholder =
            stringResource(
                if (kind ==
                    TermKind.Material
                ) {
                    R.string.chart_type_material
                } else {
                    R.string.chart_type_procedure
                },
            ),
    )
    if (!typing || text.isBlank()) return
    val matches = matchTerms(choices.terms, kind, text).take(MAX_OPTIONS)
    Column(Modifier.fillMaxWidth().padding(top = Spacing.XS.dp)) {
        matches.forEach { term ->
            Text(
                if (term.own) stringResource(R.string.chart_term_own, term.label) else term.label,
                style = SkTypography.bodyText,
                color = colors.text.color,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .sizeIn(minHeight = Spacing.MIN_TOUCH_TARGET.dp)
                        .clickable(role = Role.Button) {
                            onPick(term)
                            text = term.label
                        }.padding(vertical = Spacing.SM.dp),
            )
        }
        if (!hasLabel(choices.terms, kind, text)) {
            Text(
                stringResource(R.string.chart_term_add, text.trim()),
                style = SkTypography.bodyStrong,
                color = colors.primary.color,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .sizeIn(minHeight = Spacing.MIN_TOUCH_TARGET.dp)
                        .clickable(enabled = !choices.adding, role = Role.Button) { onAdd(text.trim()) }
                        .padding(vertical = Spacing.SM.dp),
            )
        } else if (matches.isEmpty()) {
            Text(
                stringResource(R.string.chart_term_none),
                style = SkTypography.footnote,
                color = colors.textMuted.color,
            )
        }
    }
}

private const val MAX_OPTIONS = 6
private const val NOTE_LIMIT = 500
