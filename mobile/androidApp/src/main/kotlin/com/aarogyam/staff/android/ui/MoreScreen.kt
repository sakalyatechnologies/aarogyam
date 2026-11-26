package com.aarogyam.staff.android.ui

import android.content.Intent
import android.net.Uri
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.clinical.openAnalytics
import com.aarogyam.staff.android.ui.clinical.openChats
import com.aarogyam.staff.android.ui.clinical.openExpenses
import com.aarogyam.staff.android.ui.clinical.openLabs
import com.aarogyam.staff.android.ui.clinical.openTeam
import com.aarogyam.staff.android.ui.more.AvatarChoice
import com.aarogyam.staff.android.ui.more.AvatarPicker
import com.aarogyam.staff.android.ui.more.DeleteAccountSheet
import com.aarogyam.staff.android.ui.more.MyAvatar
import com.aarogyam.staff.android.ui.more.openHelp
import com.aarogyam.staff.android.ui.more.openStock
import com.aarogyam.staff.android.ui.more.openTimeOff
import com.aarogyam.staff.android.ui.today.ClinicQrSheet
import com.aarogyam.staff.android.ui.today.bookingUrl
import com.aarogyam.staff.art.Icons
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.nav.MoreTile
import com.aarogyam.staff.nav.NavModel
import com.aarogyam.staff.outbox.SignOutResult
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkAvatarFrame
import com.sakalya.mobile.designcompose.SkAvatarShape
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
        MoreTile.TimeOff,
        MoreTile.ClinicQr,
        MoreTile.SelfCheckIn,
        MoreTile.RxSets,
        MoreTile.Settings,
    )

/** Tiles drawn on the tertiary container in the mockup (`.tile.w`). */
private val WARM = setOf(MoreTile.Expenses, MoreTile.Stock)

/**
 * The More page of the v7 design (iOS `MoreScreen`): the person's row (avatar, name, role, clinic), a three-column
 * grid of tiles for the role, then Switch clinic, Language, Help and Sign out. Tiles open the other areas through
 * [nav]; RX sets has no page yet and says so. Sign out asks first when writes are not sent yet.
 */
@Composable
fun MoreScreen(
    graph: AppGraph,
    clinic: ClinicContext,
    model: NavModel,
    nav: NavController,
    onSwitchClinic: () -> Unit,
) {
    var language by rememberSaveable { mutableStateOf(false) }
    var appearance by rememberSaveable { mutableStateOf(false) }
    val currentAppearance by graph.appearance.state.collectAsStateWithLifecycle()
    var avatars by rememberSaveable { mutableStateOf(false) }
    var qr by rememberSaveable { mutableStateOf(false) }
    var selfCheckIn by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    var soon by rememberSaveable { mutableStateOf(false) }
    var unsent by rememberSaveable { mutableStateOf<Int?>(null) }
    var avatar by remember { mutableStateOf(AvatarChoice.current(graph)) }
    val context = LocalContext.current
    val open = { tile: MoreTile ->
        when (tile) {
            MoreTile.Analytics -> {
                nav.openAnalytics()
            }

            MoreTile.Expenses -> {
                nav.openExpenses()
            }

            MoreTile.Messages -> {
                nav.openChats()
            }

            MoreTile.Stock -> {
                nav.openStock()
            }

            MoreTile.LabWork -> {
                nav.openLabs()
            }

            MoreTile.Team -> {
                nav.openTeam()
            }

            MoreTile.TimeOff -> {
                nav.openTimeOff()
            }

            MoreTile.ClinicQr -> {
                qr = true
            }

            MoreTile.SelfCheckIn -> {
                selfCheckIn = true
            }

            MoreTile.RxSets -> {
                soon = true
            }

            MoreTile.Settings -> {
                val url = clinic.api.origin.trim(' ', '/') + "/settings"
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
            }

            MoreTile.SwitchClinic -> {
                onSwitchClinic()
            }

            MoreTile.Language -> {
                language = true
            }

            MoreTile.Appearance -> {
                appearance = true
            }

            MoreTile.Help -> {
                nav.openHelp()
            }

            MoreTile.SignOut -> {
                // Writes not sent yet would be lost: ask first.
                (graph.trySignOut() as? SignOutResult.SignOutBlocked)?.let { unsent = it.pendingCount }
            }
        }
    }
    val p = SkTheme.palette
    Column(Modifier.verticalScroll(rememberScrollState())) {
        SkCollapsingTopBar(stringResource(R.string.v7_more_title), collapsed = false)
        Column(Modifier.padding(horizontal = Spacing.L.dp)) {
            ProfileRow(clinic, avatar) { avatars = true }
            model.tiles.filter { it in GRID }.chunked(COLUMNS).forEach { row ->
                Row(Modifier.padding(top = TILE_GAP.dp), horizontalArrangement = Arrangement.spacedBy(TILE_GAP.dp)) {
                    row.forEach { tile -> Tile(tile, tile in WARM, Modifier.weight(1f)) { open(tile) } }
                    repeat(COLUMNS - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }
            Spacer(Modifier.height(Spacing.M.dp))
            val rows = model.tiles.filter { it !in GRID }
            rows.forEachIndexed { i, tile ->
                val top = if (i == 0) BIG else SMALL
                val bottom = if (i == rows.lastIndex) BIG else SMALL
                val sub =
                    when (tile) {
                        MoreTile.SwitchClinic -> clinic.session.clinic.name
                        else -> tile.subtitle?.let { stringResource(it) }
                    }
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
                    Column(Modifier.weight(1f)) {
                        Text(
                            stringResource(tile.label),
                            style = SkTypography.bodyStrong,
                            color = if (tile == MoreTile.SignOut) p.error.color else p.onSurface.color,
                        )
                        sub?.let { Text(it, style = SkTypography.caption, color = p.onSurfaceVariant.color) }
                    }
                    SkIcon(Icons.of("chev"), p.onSurfaceVariant.color, size = CHEV.dp)
                }
            }
            if (soon) {
                Text(
                    stringResource(R.string.v7_soon),
                    style = SkTypography.footnote,
                    color = p.onSurfaceVariant.color,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.M.dp),
                )
            }
            Text(
                stringResource(R.string.sh_store_delete_row),
                style = SkTypography.footnote.copy(fontWeight = FontWeight.Bold),
                color = p.error.color,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(role = Role.Button) { deleting = true }
                        .padding(top = Spacing.L.dp, bottom = Spacing.S.dp),
            )
            Text(
                stringResource(R.string.sh_v7_more_version),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.L.dp),
            )
            Spacer(Modifier.height(BOTTOM_CLEARANCE.dp))
        }
    }
    if (language) LanguageDialog(graph.voiceLanguage(), graph::setVoiceLanguage) { language = false }
    if (appearance) {
        AppearanceDialog(currentAppearance, {
            graph.appearance.set(it)
            applyAppearance(it)
        }) { appearance = false }
    }
    if (avatars) {
        AvatarPicker(graph, clinic, onChange = { avatar = AvatarChoice.current(graph) }) { avatars = false }
    }
    if (deleting) DeleteAccountSheet(graph) { deleting = false }
    if (selfCheckIn) {
        val scope = rememberCoroutineScope()
        val holder = remember { graph.selfCheckIn(clinic, scope) }
        SelfCheckInSheet(holder, clinic.session.clinic.name) { selfCheckIn = false }
    }
    if (qr) ClinicQrSheet(bookingUrl(clinic.api.origin), clinic.session.clinic.name) { qr = false }
    unsent?.let { count ->
        AlertDialog(
            onDismissRequest = { unsent = null },
            title = { Text(stringResource(R.string.sh_outbox_signout_title, count)) },
            confirmButton = {
                TextButton({
                    unsent = null
                    graph.signOut()
                }) { Text(stringResource(R.string.sh_outbox_signout_anyway), color = p.error.color) }
            },
            dismissButton = { TextButton({ unsent = null }) { Text(stringResource(R.string.sh_outbox_signout_stay)) } },
        )
    }
}

/** The person's row: avatar, name, role and clinic, and "Change avatar or photo". */
@Composable
private fun ProfileRow(
    clinic: ClinicContext,
    avatar: String,
    onClick: () -> Unit,
) {
    val p = SkTheme.palette
    val session = clinic.session
    Row(
        Modifier
            .padding(top = 4.dp)
            .fillMaxWidth()
            .background(p.surface1.color, RoundedCornerShape(CARD_RADIUS.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .padding(Spacing.M.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
    ) {
        SkAvatarFrame(SkAvatarShape.Pebble, AVATAR.dp, p.primaryContainer.color) { MyAvatar(avatar) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(session.user.displayName, style = SkTypography.titleSmall, color = p.onSurface.color)
            Text(
                "${roleName(session.membership.roleKey)} · ${session.clinic.name}",
                style = SkTypography.footnote,
                color = p.onSurfaceVariant.color,
            )
            Text(
                stringResource(R.string.sh_v7_more_change_avatar),
                style = SkTypography.footnote.copy(fontWeight = FontWeight.Bold),
                color = p.primary.color,
            )
        }
        SkIcon(Icons.of("chev"), p.onSurfaceVariant.color, size = CHEV.dp)
    }
}

/** Role keys as people read them. */
@Composable
private fun roleName(key: String): String =
    when (key) {
        "owner" -> stringResource(R.string.sh_v7_role_owner)
        "doctor" -> stringResource(R.string.sh_v7_role_doctor)
        "consultant" -> stringResource(R.string.sh_v7_role_consultant)
        "front_desk" -> stringResource(R.string.sh_v7_role_front_desk)
        "assistant" -> stringResource(R.string.sh_v7_role_assistant)
        "finance" -> stringResource(R.string.sh_v7_role_finance)
        else -> key
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
            style = SkTypography.footnote.copy(fontWeight = FontWeight.Bold),
            color = p.onSurface.color,
            textAlign = TextAlign.Center,
            maxLines = 2,
        )
        tile.subtitle?.let {
            Text(
                stringResource(it),
                style = SkTypography.caption,
                color = p.onSurfaceVariant.color,
                textAlign = TextAlign.Center,
                maxLines = 1,
            )
        }
    }
}

/** The small line under a tile's label; null for none. */
private val MoreTile.subtitle: Int?
    get() =
        when (this) {
            MoreTile.Analytics -> R.string.sh_v7_tile_analytics_sub
            MoreTile.Expenses -> R.string.sh_v7_tile_expenses_sub
            MoreTile.Messages -> R.string.sh_v7_tile_messages_sub
            MoreTile.Stock -> R.string.sh_v7_tile_stock_sub
            MoreTile.LabWork -> R.string.sh_v7_tile_lab_work_sub
            MoreTile.Team -> R.string.sh_v7_tile_team_sub
            MoreTile.TimeOff -> R.string.timeoff_tile_sub
            MoreTile.ClinicQr -> R.string.sh_v7_tile_clinic_qr_sub
            MoreTile.SelfCheckIn -> R.string.selfcheckin_tile_sub
            MoreTile.RxSets -> R.string.sh_v7_tile_rx_sets_sub
            MoreTile.Settings -> R.string.sh_v7_tile_settings_sub
            MoreTile.Help -> R.string.sh_v7_tile_help_sub
            else -> null
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
            MoreTile.TimeOff -> R.string.timeoff_title
            MoreTile.ClinicQr -> R.string.v7_tile_clinic_qr
            MoreTile.SelfCheckIn -> R.string.selfcheckin_tile
            MoreTile.RxSets -> R.string.v7_tile_rx_sets
            MoreTile.Settings -> R.string.v7_tile_settings
            MoreTile.SwitchClinic -> R.string.v7_tile_switch_clinic
            MoreTile.Language -> R.string.v7_tile_language
            MoreTile.Appearance -> R.string.appearance_title
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
            MoreTile.TimeOff -> "cal"
            MoreTile.ClinicQr -> "qr"
            MoreTile.SelfCheckIn -> "qr"
            MoreTile.RxSets -> "rx"
            MoreTile.Settings -> "gear"
            MoreTile.SwitchClinic -> "swap"
            MoreTile.Language -> "globe"
            MoreTile.Appearance -> "spark"
            MoreTile.Help -> "help"
            MoreTile.SignOut -> "out"
        }

// Measured from the mockup's More page CSS (.tiles, .tile, .ti, .li, .list).
private const val COLUMNS = 2
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
private const val CARD_RADIUS = 22
private const val AVATAR = 54
private const val BIG = 22
private const val SMALL = 8
private const val BOTTOM_CLEARANCE = 96
