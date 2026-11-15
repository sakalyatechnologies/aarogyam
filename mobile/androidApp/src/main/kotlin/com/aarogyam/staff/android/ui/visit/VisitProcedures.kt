package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.chart.label
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.ChartState
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.Surface
import com.aarogyam.staff.chart.TermKind
import com.aarogyam.staff.chart.TermView
import com.aarogyam.staff.chart.ToothView
import com.aarogyam.staff.chart.matchTerms
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Treatment done: tooth chips, procedure chips and the lines added so far; logged when the visit closes. */
@Composable
internal fun VisitProcedures(
    chart: ChartStateHolder,
    state: ChartState,
    staged: List<StagedProcedure>,
    onStaged: (List<StagedProcedure>) -> Unit,
    locked: Boolean,
) {
    var tooth by remember { mutableStateOf<Int?>(null) }
    var needTooth by remember { mutableStateOf(false) }
    var nextId by remember { mutableIntStateOf(1) }
    SkCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SectionTitle(stringResource(R.string.vv_v9v_proc_title))
                Muted(
                    if (staged.isEmpty()) {
                        stringResource(
                            R.string.vv_v9v_proc_sub,
                        )
                    } else {
                        stringResource(R.string.vv_v9v_proc_count, staged.size)
                    },
                )
            }
            when (state) {
                ChartState.Loading -> {
                    Muted(stringResource(R.string.vv_v9v_proc_loading))
                }

                ChartState.NotAllowed -> {
                    Muted(stringResource(R.string.vv_v9v_proc_not_allowed))
                }

                is ChartState.Failed -> {
                    ErrorLine(stringResource(state.error.message()))
                    SkButton(
                        stringResource(R.string.vv_v9v_retry),
                        onClick = chart::refresh,
                        variant = SkButtonVariant.Secondary,
                    )
                }

                is ChartState.Loaded -> {
                    Picker(state, staged, tooth, needTooth, locked, onTooth = {
                        tooth = it
                        needTooth = false
                    }) { term ->
                        val picked = tooth
                        if (picked ==
                            null
                        ) {
                            needTooth = true
                        } else {
                            onStaged(staged + StagedProcedure(nextId++, picked, term))
                        }
                    }
                    if (staged.isNotEmpty()) StagedLines(state, staged, onStaged, locked)
                }
            }
        }
    }
}

@Composable
private fun Picker(
    chart: ChartState.Loaded,
    staged: List<StagedProcedure>,
    tooth: Int?,
    needTooth: Boolean,
    locked: Boolean,
    onTooth: (Int) -> Unit,
    onAdd: (TermView) -> Unit,
) {
    val all = (chart.upper + chart.lower).map { it.number }
    val offered =
        (
            (chart.upper + chart.lower).filter { it.findings.isNotEmpty() }.map { it.number } +
                staged.map { it.tooth } +
                listOfNotNull(tooth)
        ).toSortedSet()
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        offered.forEach { number ->
            VisitChip(number.toString(), tooth == number) { onTooth(number) }
        }
        Box {
            WellChip(stringResource(R.string.vv_v9v_proc_other), stringResource(R.string.vv_v9v_proc_other)) {
                menu =
                    true
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                all.forEach { number ->
                    DropdownMenuItem(text = { Text(number.toString()) }, onClick = {
                        menu = false
                        onTooth(number)
                    })
                }
            }
        }
    }
    if (needTooth) ErrorLine(stringResource(R.string.vv_v9v_proc_pick_tooth))
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        matchTerms(chart.terms, TermKind.Procedure, "").forEach { term ->
            WellChip("+ ${term.label}", stringResource(R.string.vv_v9v_proc_add_a11y, term.label), enabled = !locked) {
                onAdd(term)
            }
        }
    }
}

@Composable
private fun StagedLines(
    chart: ChartState.Loaded,
    staged: List<StagedProcedure>,
    onStaged: (List<StagedProcedure>) -> Unit,
    locked: Boolean,
) {
    val teeth = chart.upper + chart.lower
    val materials = matchTerms(chart.terms, TermKind.Material, "")
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.S.dp)) {
        staged.forEach { item ->
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(
                        RoundedCornerShape(Spacing.L.dp),
                    ).background(SkTheme.colors.inset.color)
                    .padding(Spacing.ML.dp),
            ) {
                ProcedureLine(
                    item,
                    teeth.firstOrNull { it.number == item.tooth },
                    materials,
                    locked,
                    onChange = { changed -> onStaged(staged.map { if (it.id == changed.id) changed else it }) },
                    onRemove = { onStaged(staged.filterNot { it.id == item.id }) },
                )
            }
        }
        Muted(stringResource(R.string.vv_v9v_proc_saved_on_close))
    }
}

/** One staged treatment: name and tooth, then optional surfaces (named for that tooth) and a material. */
@Composable
private fun ProcedureLine(
    item: StagedProcedure,
    tooth: ToothView?,
    materials: List<TermView>,
    locked: Boolean,
    onChange: (StagedProcedure) -> Unit,
    onRemove: () -> Unit,
) {
    val colors = SkTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(item.term.label, style = SkTypography.bodyStrong, color = colors.text.color)
                Muted(stringResource(R.string.vv_v9v_proc_tooth, item.tooth))
            }
            if (!locked) {
                RoundGlyph(
                    "×",
                    stringResource(R.string.vv_v9v_proc_remove_a11y, item.term.label),
                    onClick = onRemove,
                )
            }
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.XS.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp),
        ) {
            listOf(Surface.M, Surface.O, Surface.D, Surface.B, Surface.L).forEach { surface ->
                val label = stringResource(tooth?.surfaceName(surface)?.label() ?: genericLabel(surface))
                val on = surface in item.surfaces
                Box(
                    Modifier
                        .size(Spacing.MIN_TOUCH_TARGET.dp)
                        .clickable(enabled = !locked, role = Role.Checkbox) {
                            onChange(item.copy(surfaces = if (on) item.surfaces - surface else item.surfaces + surface))
                        }.semantics { contentDescription = label },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .size(
                                SURFACE.dp,
                            ).clip(CircleShape)
                            .background(if (on) colors.primary.color else colors.card.color),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            label.take(1),
                            style = SkTypography.label,
                            color = if (on) colors.onPrimary.color else colors.text.color,
                        )
                    }
                }
            }
        }
        if (materials.isNotEmpty()) MaterialPick(item, materials, locked, onChange)
    }
}

private fun genericLabel(surface: Surface): Int =
    when (surface) {
        Surface.M -> R.string.surface_mesial
        Surface.D -> R.string.surface_distal
        Surface.O -> R.string.surface_occlusal_incisal
        Surface.B -> R.string.surface_buccal_labial
        Surface.L -> R.string.surface_lingual_palatal
    }

@Composable
private fun MaterialPick(
    item: StagedProcedure,
    materials: List<TermView>,
    locked: Boolean,
    onChange: (StagedProcedure) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val title = item.material?.label ?: stringResource(R.string.vv_v9v_proc_material)
    Box {
        WellChip(title, stringResource(R.string.vv_v9v_proc_material), enabled = !locked) { open = true }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.vv_v9v_proc_material_none)) }, onClick = {
                open =
                    false
                ; onChange(item.copy(material = null))
            })
            materials.forEach { term ->
                DropdownMenuItem(text = { Text(term.label) }, onClick = {
                    open = false
                    onChange(item.copy(material = term))
                })
            }
        }
    }
}

private const val SURFACE = 36
