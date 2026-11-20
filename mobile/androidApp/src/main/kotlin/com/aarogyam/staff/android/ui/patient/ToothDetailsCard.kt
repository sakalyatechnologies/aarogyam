package com.aarogyam.staff.android.ui.patient

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.chart.Angulation
import com.aarogyam.staff.chart.CariesDepth
import com.aarogyam.staff.chart.Eruption
import com.aarogyam.staff.chart.MOBILITY_GRADES
import com.aarogyam.staff.chart.POCKET_CHIPS_MM
import com.aarogyam.staff.chart.RootInfection
import com.aarogyam.staff.chart.ToothDetailsView
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * The optional detail chips (spec 1.13): decay depth on a tooth with decay, the condition row
 * (infection, gums, mobility) on every tooth, and a wisdom tooth's eruption and angle. Each tap
 * saves at once; a tap on the picked chip clears it. Skipping them costs nothing.
 */
@Composable
internal fun ToothDetailsCard(
    sheet: ToothSheetStateHolder,
    tooth: Int,
    details: ToothDetailsView,
) {
    val save by sheet.detail.collectAsStateWithLifecycle()
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            V7Label(stringResource(R.string.pv_detail_title))
            V7Muted(stringResource(R.string.pv_detail_hint))
            if (details.hasCaries) {
                V7Label(stringResource(R.string.pv_detail_depth))
                val labels = CariesDepth.entries.associateWith { stringResource(it.label()) }
                SkChoiceChips(
                    CariesDepth.entries,
                    setOfNotNull(details.cariesDepth),
                    { sheet.setCariesDepth(tooth, it) },
                    { labels.getValue(it) },
                )
            }
            if (!details.missing) Condition(sheet, tooth, details)
            if (details.wisdom) Wisdom(sheet, tooth, details)
            if (save.error != null) {
                Text(
                    stringResource(R.string.pv_detail_failed),
                    style = v7(12.5f),
                    color = SkTheme.palette.error.color,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}

/** Infection, gums and mobility, with the date they were recorded. */
@Composable
private fun Condition(
    sheet: ToothSheetStateHolder,
    tooth: Int,
    details: ToothDetailsView,
) {
    val condition = details.condition
    V7Label(stringResource(R.string.pv_detail_infection))
    val infections = RootInfection.entries.associateWith { stringResource(it.label()) }
    SkChoiceChips(
        RootInfection.entries,
        setOfNotNull(condition?.infection),
        { sheet.setInfection(tooth, it.takeIf { picked -> picked != condition?.infection }) },
        { infections.getValue(it) },
    )
    if (details.canResolveInfection) {
        SkPillButton(stringResource(R.string.pv_detail_resolved), { sheet.resolveInfection(tooth) })
    }
    V7Label(stringResource(R.string.pv_detail_gums))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SkChoiceChip(
            stringResource(R.string.pv_detail_bleeding),
            condition?.bleeding == true,
            { sheet.setBleeding(tooth, condition?.bleeding != true) },
            single = false,
        )
        POCKET_CHIPS_MM.forEach { mm ->
            val on = pocketChip(condition?.pocketMm) == mm
            SkChoiceChip(
                stringResource(R.string.pv_detail_pocket, if (mm == POCKET_CHIPS_MM.last()) "$mm+" else "$mm"),
                on,
                { sheet.setPocket(tooth, mm.takeIf { !on }) },
            )
        }
    }
    V7Label(stringResource(R.string.pv_detail_mobility))
    val grades = MOBILITY_GRADES.associateWith { stringResource(R.string.pv_detail_mobility_grade, it) }
    SkChoiceChips(
        MOBILITY_GRADES,
        setOfNotNull(condition?.mobility),
        { sheet.setMobility(tooth, it.takeIf { grade -> grade != condition?.mobility }) },
        { grades.getValue(it) },
    )
    condition?.at?.date?.let { V7Muted(stringResource(R.string.pv_detail_recorded, it.display())) }
}

@Composable
private fun Wisdom(
    sheet: ToothSheetStateHolder,
    tooth: Int,
    details: ToothDetailsView,
) {
    val eruption = details.eruption
    V7Label(stringResource(R.string.pv_detail_wisdom))
    val eruptions = Eruption.entries.associateWith { stringResource(it.label()) }
    SkChoiceChips(
        Eruption.entries,
        setOfNotNull(eruption?.eruption),
        { sheet.setEruption(tooth, it) },
        { eruptions.getValue(it) },
    )
    if (eruption != null && eruption.eruption.takesAngle) {
        V7Label(stringResource(R.string.pv_detail_angle))
        val angles = Angulation.entries.associateWith { stringResource(it.label()) }
        SkChoiceChips(
            Angulation.entries,
            setOfNotNull(eruption.angulation),
            { sheet.setAngulation(tooth, it) },
            { angles.getValue(it) },
        )
    }
    eruption?.at?.date?.let { V7Muted(stringResource(R.string.pv_detail_recorded, it.display())) }
}

/** A pocket deeper than 7 mm (from the web) lights the "7+" chip. */
private fun pocketChip(mm: Int?): Int? = mm?.coerceAtMost(POCKET_CHIPS_MM.last())

@StringRes
private fun CariesDepth.label(): Int =
    when (this) {
        CariesDepth.Enamel -> R.string.pv_detail_depth_enamel
        CariesDepth.Dentin -> R.string.pv_detail_depth_dentin
        CariesDepth.NearPulp -> R.string.pv_detail_depth_near_pulp
    }

@StringRes
private fun RootInfection.label(): Int =
    when (this) {
        RootInfection.Infection -> R.string.pv_detail_infection_infection
        RootInfection.Abscess -> R.string.pv_detail_infection_abscess
    }

@StringRes
private fun Eruption.label(): Int =
    when (this) {
        Eruption.Erupted -> R.string.pv_detail_eruption_erupted
        Eruption.Partial -> R.string.pv_detail_eruption_partial
        Eruption.Impacted -> R.string.pv_detail_eruption_impacted
        Eruption.Unerupted -> R.string.pv_detail_eruption_unerupted
    }

@StringRes
private fun Angulation.label(): Int =
    when (this) {
        Angulation.Vertical -> R.string.pv_detail_angle_vertical
        Angulation.Mesioangular -> R.string.pv_detail_angle_mesioangular
        Angulation.Distoangular -> R.string.pv_detail_angle_distoangular
        Angulation.Horizontal -> R.string.pv_detail_angle_horizontal
    }
