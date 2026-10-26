package com.aarogyam.staff.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.nav.MoreTile
import com.aarogyam.staff.nav.NavModel
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCollapsingTopBar
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color
import com.sakalya.mobile.designcompose.skPressable

/** The tiles of the v7 grid; the rest are list rows below it. */
private val GRID =
    listOf(
        MoreTile.Analytics,
        MoreTile.Expenses,
        MoreTile.Messages,
        MoreTile.Stock,
        MoreTile.LabWork,
        MoreTile.Team,
        MoreTile.ClinicQr,
        MoreTile.RxSets,
        MoreTile.Settings,
    )

/** Tiles drawn on the tertiary container in the mockup (`.tile.w`). */
private val WARM = setOf(MoreTile.Expenses, MoreTile.Stock)

/**
 * The More page of the v7 design: a three-column grid of tiles for the role, then Switch clinic,
 * Language, Help and Sign out. Tiles whose page is not built yet say so instead of opening.
 */
@Composable
fun MoreScreen(
    nav: NavModel,
    onSwitchClinic: () -> Unit,
    onSignOut: () -> Unit,
    onOpen: (MoreTile) -> Boolean = { false },
) {
    var language by rememberSaveable { mutableStateOf(false) }
    var soon by rememberSaveable { mutableStateOf<MoreTile?>(null) }
    val open = { tile: MoreTile ->
        when (tile) {
            MoreTile.SwitchClinic -> onSwitchClinic()
            MoreTile.Language -> language = true
            MoreTile.SignOut -> onSignOut()
            else -> if (!onOpen(tile)) soon = tile
        }
    }
    val p = SkTheme.palette
    Column(Modifier.verticalScroll(rememberScrollState())) {
        SkCollapsingTopBar(stringResource(R.string.v7_more_title), collapsed = false)
        Column(Modifier.padding(horizontal = Spacing.L.dp)) {
            nav.tiles.filter { it in GRID }.chunked(COLUMNS).forEach { row ->
                Row(Modifier.padding(top = TILE_GAP.dp), horizontalArrangement = Arrangement.spacedBy(TILE_GAP.dp)) {
                    row.forEach { tile -> Tile(tile, tile in WARM, Modifier.weight(1f)) { open(tile) } }
                    repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            Spacer(Modifier.height(Spacing.M.dp))
            val rows = nav.tiles.filter { it !in GRID }
            rows.forEachIndexed { i, tile ->
                val top = if (i == 0) BIG else SMALL
                val bottom = if (i == rows.lastIndex) BIG else SMALL
                Row(
                    Modifier
                        .padding(top = ROW_GAP.dp)
                        .fillMaxWidth()
                        .background(p.surface1.color, RoundedCornerShape(top.dp, top.dp, bottom.dp, bottom.dp))
                        .clickable(role = Role.Button) { open(tile) }
                        .padding(horizontal = ROW_PAD_H.dp, vertical = ROW_PAD_V.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(ROW_GAP_INNER.dp),
                ) {
                    SkIcon(Icons.of(tile.icon), p.onSurfaceVariant.color, size = ROW_ICON.dp)
                    Text(
                        stringResource(tile.label),
                        style = SkTypography.bodyStrong,
                        color = p.onSurface.color,
                        modifier = Modifier.weight(1f),
                    )
                    SkIcon(Icons.of("chev"), p.onSurfaceVariant.color, size = CHEV.dp)
                }
            }
            soon?.let {
                Text(
                    stringResource(R.string.v7_soon),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.M.dp),
                )
            }
            Spacer(Modifier.height(BOTTOM_CLEARANCE.dp))
        }
    }
    if (language) LanguageDialog(onDismiss = { language = false })
}

@Composable
private fun Tile(
    tile: MoreTile,
    warm: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    val p = SkTheme.palette
    val source = remember { MutableInteractionSource() }
    Column(
        modifier
            .skPressable(source)
            .background(p.surface1.color, RoundedCornerShape(TILE_RADIUS.dp))
            .clickable(source, null, role = Role.Button, onClick = onClick)
            .padding(vertical = TILE_PAD_V.dp, horizontal = TILE_PAD_H.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(TILE_INNER.dp),
    ) {
        Box(
            Modifier
                .size(
                    TILE_ICON_BOX.dp,
                ).background(if (warm) p.tertiaryContainer.color else p.primaryContainer.color, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            SkIcon(
                Icons.of(tile.icon),
                if (warm) p.onTertiaryContainer.color else p.onPrimaryContainer.color,
                size = TILE_ICON.dp,
            )
        }
        Text(
            stringResource(tile.label),
            style = SkTypography.caption.copy(fontWeight = FontWeight.Bold),
            color = p.onSurface.color,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
    }
}

private val MoreTile.label: Int
    get() =
        when (this) {
            MoreTile.Analytics -> R.string.v7_tile_analytics
            MoreTile.Expenses -> R.string.v7_tile_expenses
            MoreTile.Messages -> R.string.v7_tile_messages
            MoreTile.Stock -> R.string.v7_tile_stock
            MoreTile.LabWork -> R.string.v7_tile_lab_work
            MoreTile.Team -> R.string.v7_tile_team
            MoreTile.ClinicQr -> R.string.v7_tile_clinic_qr
            MoreTile.RxSets -> R.string.v7_tile_rx_sets
            MoreTile.Settings -> R.string.v7_tile_settings
            MoreTile.SwitchClinic -> R.string.v7_tile_switch_clinic
            MoreTile.Language -> R.string.v7_tile_language
            MoreTile.Help -> R.string.v7_tile_help
            MoreTile.SignOut -> R.string.v7_tile_sign_out
        }

/** The mockup's icons for each tile (`more()`). */
private val MoreTile.icon: String
    get() =
        when (this) {
            MoreTile.Analytics -> "chart"
            MoreTile.Expenses -> "wallet"
            MoreTile.Messages -> "msg"
            MoreTile.Stock -> "box"
            MoreTile.LabWork -> "flask"
            MoreTile.Team -> "team"
            MoreTile.ClinicQr -> "qr"
            MoreTile.RxSets -> "rx"
            MoreTile.Settings -> "gear"
            MoreTile.SwitchClinic -> "swap"
            MoreTile.Language -> "globe"
            MoreTile.Help -> "help"
            MoreTile.SignOut -> "out"
        }

// Measured from the mockup's More page CSS (.tiles, .tile, .ti, .li, .list).
private const val COLUMNS = 3
private const val TILE_GAP = 8
private const val TILE_RADIUS = 20
private const val TILE_PAD_V = 12
private const val TILE_PAD_H = 8
private const val TILE_INNER = 6
private const val TILE_ICON_BOX = 38
private const val TILE_ICON = 19
private const val ROW_GAP = 3
private const val ROW_GAP_INNER = 10
private const val ROW_PAD_H = 11
private const val ROW_PAD_V = 9
private const val ROW_ICON = 19
private const val CHEV = 18
private const val BIG = 22
private const val SMALL = 8
private const val BOTTOM_CLEARANCE = 96
