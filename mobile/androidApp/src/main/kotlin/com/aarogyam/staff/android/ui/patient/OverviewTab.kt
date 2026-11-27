package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.chart.label
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.chart.ChartState
import com.aarogyam.staff.chart.ChartStateHolder
import com.aarogyam.staff.chart.Dentition
import com.aarogyam.staff.chart.HealthMark
import com.aarogyam.staff.chart.healthMark
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.FlagsView
import com.aarogyam.staff.patients.LastVisitView
import com.aarogyam.staff.patients.MediaKind
import com.aarogyam.staff.patients.MediaView
import com.aarogyam.staff.patients.OverviewState
import com.aarogyam.staff.patients.PatientOverviewStateHolder
import com.aarogyam.staff.patients.Severity
import com.aarogyam.staff.patients.TreatmentRow
import com.aarogyam.staff.patients.TxStatus
import com.aarogyam.staff.visit.RecallsStateHolder
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkSegmented
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The Overview tab: the jaw, health alerts, follow-ups and the X-ray and photo tiles. */
@Composable
internal fun OverviewTab(
    graph: AppGraph,
    clinic: ClinicContext,
    holder: PatientOverviewStateHolder,
    chartHolder: ChartStateHolder?,
    followUps: RecallsStateHolder?,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val title = stringResource(R.string.p9_tab_overview)
    when (val current = state) {
        OverviewState.Loading -> SectionState(title, SectionKind.Loading)
        OverviewState.NotAllowed -> SectionState(title, SectionKind.NotAllowed)
        is OverviewState.Failed -> SectionState(title, SectionKind.Failed(current.error), holder::refresh)
        is OverviewState.Loaded -> Loaded(graph, clinic, holder, current, chartHolder, followUps)
    }
}

@Composable
private fun Loaded(
    graph: AppGraph,
    clinic: ClinicContext,
    holder: PatientOverviewStateHolder,
    loaded: OverviewState.Loaded,
    chartHolder: ChartStateHolder?,
    followUps: RecallsStateHolder?,
) {
    val chart = chartHolder?.state?.collectAsStateWithLifecycle()?.value
    var sheetOpen by remember { mutableStateOf(false) }
    var dictate by remember { mutableStateOf(false) }
    val pick = { tooth: Int ->
        chartHolder?.select(tooth, null)
        dictate = false
        sheetOpen = true
    }
    // A long press opens the tooth with its note already being dictated.
    val pickAndDictate = { tooth: Int ->
        chartHolder?.select(tooth, null)
        dictate = true
        sheetOpen = true
    }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        loaded.error?.let { ErrorLine(it) }
        JawCard(chart, chartHolder, pick, pickAndDictate)
        AlertsCard(loaded.alerts)
        if (followUps != null) {
            val recalls by followUps.state.collectAsStateWithLifecycle()
            FollowUpsCard(followUps, recalls, "patients.write" in clinic.permissions)
        }
        MediaCard(loaded.media)
    }
    val loadedChart = chart as? ChartState.Loaded
    val selection = loadedChart?.selected
    if (sheetOpen && chartHolder != null && loadedChart != null && selection != null) {
        ToothSheet(graph, clinic, chartHolder, loadedChart, selection, dictate) {
            sheetOpen = false
            chartHolder.clearSelection()
            holder.refresh()
        }
    }
}

@Composable
internal fun JawCard(
    chart: ChartState?,
    chartHolder: ChartStateHolder?,
    pick: (Int) -> Unit,
    dictate: (Int) -> Unit,
) {
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val title = stringResource(R.string.chart_title)
            when (chart) {
                is ChartState.Loaded -> {
                    SkSegmented(
                        listOf(stringResource(R.string.chart_adult), stringResource(R.string.chart_child)),
                        chart.dentition.ordinal,
                        { chartHolder?.showDentition(Dentition.entries[it]) },
                    )
                    val teeth =
                        remember(chart.upper, chart.lower) { (chart.upper + chart.lower).associateBy { it.number } }
                    var health by rememberSaveable { mutableStateOf(false) }
                    val lens =
                        listOf(stringResource(R.string.pv_jaw_view_findings), stringResource(R.string.pv_tooth_health))
                    SkChoiceChips(lens, setOf(lens[if (health) 1 else 0]), { health = it == lens[1] }, { it })
                    if (health) {
                        val marks = healthMarkTexts()
                        JawChart(
                            chart.dentition,
                            teeth,
                            chart.upper,
                            chart.lower,
                            pick,
                            onLongSelect = dictate,
                            tone = { chart.healthMark(it).tone() },
                            label = { marks.getValue(chart.healthMark(it)) },
                            glyph = { chart.healthMark(it).glyph() },
                            outlined = { chart.healthMark(it) == HealthMark.NotAssessed },
                        )
                        JawLegend(
                            HealthMark.entries.map {
                                it.tone() to
                                    listOfNotNull(it.glyph(), marks.getValue(it)).joinToString(" ")
                            },
                        )
                    } else {
                        JawChart(chart.dentition, teeth, chart.upper, chart.lower, pick, onLongSelect = dictate)
                        JawLegend()
                    }
                }

                is ChartState.Failed -> {
                    SectionState(title, SectionKind.Failed(chart.error), chartHolder?.let { it::refresh })
                }

                ChartState.NotAllowed -> {
                    SectionState(title, SectionKind.NotAllowed)
                }

                else -> {
                    SectionState(title, SectionKind.Loading)
                }
            }
        }
    }
}

@Composable
private fun AlertsCard(alerts: FlagsView) {
    val texts = alertTexts(alerts)
    if (texts.isEmpty()) return
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(stringResource(R.string.p9_alerts), stringResource(R.string.p9_alerts_note))
            Flow { texts.forEach { (text, severe) -> V7Pill(text, if (severe) PillKind.Error else PillKind.Warm) } }
        }
    }
}

@Composable
private fun alertTexts(alerts: FlagsView): List<Pair<String, Boolean>> =
    if (alerts.detailsHidden) {
        buildList {
            if (alerts.allergyCount >
                0
            ) {
                add(stringResource(R.string.pv_flag_allergies, alerts.allergyCount) to alerts.severeAllergy)
            }
            if (alerts.conditionCount >
                0
            ) {
                add(stringResource(R.string.pv_flag_conditions, alerts.conditionCount) to false)
            }
        }
    } else {
        alerts.allergies.map { it.substance to (it.severity == Severity.Severe) } +
            alerts.conditions.map { it to false }
    }

@Composable
private fun MediaCard(media: List<MediaView>) {
    if (media.isEmpty()) return
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionHead(stringResource(R.string.p9_media), media.size.toString())
            MediaGrid(media.map { MediaTileData(it.kind == MediaKind.Xray, it.label, it.at?.date?.display()) })
        }
    }
}

/** What one X-ray or photo tile shows. */
internal data class MediaTileData(
    val xray: Boolean,
    val label: String?,
    val date: String?,
)

/** The X-ray and photo tiles, two or three to a row. */
@Composable
internal fun MediaGrid(tiles: List<MediaTileData>) {
    val p = SkTheme.palette
    Flow(Modifier.fillMaxWidth(), spacing = 8.dp) {
        tiles.forEach { tile ->
            val title = tile.label ?: stringResource(if (tile.xray) R.string.p9_media_xray else R.string.p9_media_photo)
            Column(
                Modifier
                    .defaultMinSize(minWidth = 104.dp, minHeight = 76.dp)
                    .background(p.surface2.color, RoundedCornerShape(16.dp))
                    .padding(8.dp)
                    .clearAndSetSemantics { contentDescription = listOfNotNull(title, tile.date).joinToString(", ") },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                V7Icon(if (tile.xray) "tooth" else "cam", p.primary.color, 22.dp)
                Text(title, style = v7(12f, FontWeight.Bold), color = p.onSurface.color, textAlign = TextAlign.Center)
                tile.date?.let { Text(it, style = v7(11f), color = p.onSurfaceVariant.color) }
            }
        }
    }
}

/** The Health view's symbols beside the colours: ✓ healthy, ! watch, ✕ needs treatment. */
private fun HealthMark.glyph(): String? =
    when (this) {
        HealthMark.Healthy -> "✓"
        HealthMark.Watch -> "!"
        HealthMark.NeedsTreatment -> "✕"
        HealthMark.NotAssessed, HealthMark.Missing -> null
    }

/** The Health view's colours: healthy green, watch yellow, needs treatment red; not assessed an outline. */
private fun HealthMark.tone(): JawTone =
    when (this) {
        HealthMark.Healthy -> JawTone.Treated
        HealthMark.Watch -> JawTone.Watch
        HealthMark.NeedsTreatment -> JawTone.Care
        HealthMark.NotAssessed -> JawTone.Plain
        HealthMark.Missing -> JawTone.Missing
    }

@Composable
private fun healthMarkTexts(): Map<HealthMark, String> =
    HealthMark.entries.associateWith {
        stringResource(
            when (it) {
                HealthMark.Healthy -> R.string.pv_tooth_health_healthy
                HealthMark.Watch -> R.string.pv_tooth_health_watch
                HealthMark.NeedsTreatment -> R.string.pv_tooth_health_needs
                HealthMark.NotAssessed -> R.string.pv_jaw_not_assessed
                HealthMark.Missing -> R.string.pv_jaw_missing
            },
        )
    }
