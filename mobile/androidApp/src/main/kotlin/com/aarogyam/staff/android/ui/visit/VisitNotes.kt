package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.device.DictationLanguage
import com.aarogyam.staff.visit.Bullet
import com.aarogyam.staff.visit.NoteSave
import com.aarogyam.staff.visit.VisitStateHolder
import com.aarogyam.staff.visit.VisitView
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Notes: dictate or write, then bullets whose tag is tapped to change section. Autosave is the holder's. */
@Composable
internal fun VisitNotes(
    holder: VisitStateHolder,
    view: VisitView,
) {
    val colors = SkTheme.colors
    var writing by remember { mutableStateOf(false) }
    val field = remember { FocusRequester() }
    // Write opens the field ready to type.
    LaunchedEffect(writing) { if (writing) field.requestFocus() }
    var language by remember { mutableStateOf(holder.defaultLanguage) }
    var draft by remember { mutableStateOf("") }
    val locked = view.save == NoteSave.Signed
    val listening = view.listening != null
    val start = rememberDictationStarter(holder)

    fun add() {
        val text = draft.trim()
        if (text.isEmpty()) return
        holder.addBullet(NoteTag.kindForNew(view.bullets), text)
        draft = ""
    }
    SkCard {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SectionTitle(stringResource(R.string.vv_v9v_notes_title))
                SkChip(stringResource(view.save.label()), tone = view.save.tone())
            }
            if (!locked) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    VoiceCapsule(
                        listening,
                        Modifier.weight(1f),
                    ) { if (listening) holder.stopListening() else start(language) }
                    PillToggle(stringResource(R.string.vv_v9v_notes_write), writing) { writing = !writing }
                }
                LanguageChips(view.listening ?: language, !listening) { language = it }
                if (listening) {
                    Text(
                        view.liveText ?: stringResource(R.string.vv_v9v_notes_listening),
                        style = SkTypography.bodyText,
                        color = colors.text.color,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clip(
                                    RoundedCornerShape(Spacing.ML.dp),
                                ).background(colors.warningSoft.color)
                                .padding(Spacing.ML.dp),
                    )
                }
                if (writing) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BasicTextField(
                            value = draft,
                            // A hardware Return (or a pasted list) types a line break: each finished line is a point.
                            onValueChange = { typed ->
                                val lines = typed.split('\n')
                                lines.dropLast(1).forEach {
                                    draft = it
                                    add()
                                }
                                draft = lines.last()
                            },
                            textStyle = SkTypography.bodyText.copy(color = colors.text.color),
                            cursorBrush = SolidColor(colors.primary.color),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = { add() }),
                            decorationBox = { inner ->
                                Box(Modifier.heightIn(min = FIELD.dp), contentAlignment = Alignment.CenterStart) {
                                    if (draft.isEmpty()) Muted(stringResource(R.string.vv_v9v_notes_prompt))
                                    inner()
                                }
                            },
                            modifier =
                                Modifier
                                    .weight(
                                        1f,
                                    ).focusRequester(field)
                                    .clip(
                                        RoundedCornerShape(Spacing.ML.dp),
                                    ).background(colors.inset.color)
                                    .padding(horizontal = Spacing.ML.dp),
                        )
                        SkButton(
                            stringResource(R.string.vv_v9v_notes_add),
                            onClick = ::add,
                            enabled = draft.isNotBlank(),
                        )
                    }
                }
            }
            if (view.bullets.isEmpty() && !listening) Muted(stringResource(R.string.vv_v9v_notes_empty))
            view.bullets.forEach { BulletRow(holder, it, locked) }
        }
    }
}

@Composable
private fun LanguageChips(
    selected: DictationLanguage,
    enabled: Boolean,
    onPick: (DictationLanguage) -> Unit,
) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        DictationLanguage.entries.forEach { VisitChip(it.chipLabel(), selected == it, enabled) { onPick(it) } }
    }
}

@Composable
internal fun VoiceCapsule(
    listening: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    val label = stringResource(if (listening) R.string.vv_v9v_notes_stop else R.string.vv_v9v_notes_dictate)
    val description =
        stringResource(if (listening) R.string.vv_v9v_notes_stop_a11y else R.string.vv_v9v_notes_dictate_a11y)
    Row(
        modifier
            .heightIn(min = CAPSULE_HEIGHT.dp)
            .clip(RoundedCornerShape(CAPSULE.dp))
            .background(colors.primary.color)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = Spacing.L.dp)
            .semantics { contentDescription = description },
        horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(if (listening) "■" else "●", color = colors.onPrimary.color, style = SkTypography.headline)
        Text(label, color = colors.onPrimary.color, style = SkTypography.bodyStrong, maxLines = 1)
    }
}

@Composable
private fun PillToggle(
    text: String,
    on: Boolean,
    onClick: () -> Unit,
) {
    val colors = SkTheme.colors
    Box(
        Modifier
            .heightIn(min = CAPSULE_HEIGHT.dp)
            .clip(RoundedCornerShape(CAPSULE.dp))
            .background(if (on) colors.text.color else colors.inset.color)
            .clickable(role = Role.Switch, onClick = onClick)
            .padding(horizontal = Spacing.L.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = SkTypography.bodyStrong, color = if (on) colors.background.color else colors.text.color)
    }
}

/** One bullet: its tag (tap to cycle), the text and a remove button. */
@Composable
private fun BulletRow(
    holder: VisitStateHolder,
    bullet: Bullet,
    locked: Boolean,
) {
    val colors = SkTheme.colors
    val (fill, ink) =
        when (NoteTag.letter(bullet.kind)) {
            "O" -> colors.infoSoft.color to colors.infoText.color
            "P" -> colors.inset.color to colors.text.color
            else -> colors.warningSoft.color to colors.warningText.color
        }
    val kind = stringResource(bullet.kind.label())
    val retag = stringResource(R.string.vv_c_visit_retag_a11y, kind)
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.M.dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .sizeIn(minWidth = TAG_WIDTH.dp, minHeight = Spacing.MIN_TOUCH_TARGET.dp)
                .clickable(enabled = !locked, role = Role.Button) { holder.retag(bullet.id, NoteTag.next(bullet.kind)) }
                .semantics { contentDescription = retag },
            contentAlignment = Alignment.TopCenter,
        ) {
            Text(
                kind,
                style = SkTypography.caption.copy(fontWeight = FontWeight.ExtraBold),
                color = ink,
                maxLines = 1,
                modifier =
                    Modifier
                        .padding(
                            top = Spacing.SM.dp,
                        ).clip(
                            RoundedCornerShape(Spacing.SM.dp),
                        ).background(fill)
                        .padding(horizontal = Spacing.SM.dp, vertical = Spacing.XS.dp),
            )
        }
        BasicTextField(
            value = bullet.text,
            onValueChange = { holder.editBullet(bullet.id, it) },
            enabled = !locked,
            textStyle = SkTypography.bodyText.copy(color = colors.text.color),
            cursorBrush = SolidColor(colors.primary.color),
            modifier = Modifier.weight(1f).heightIn(min = Spacing.MIN_TOUCH_TARGET.dp).padding(top = Spacing.M.dp),
        )
        if (!locked) RoundGlyph("×", stringResource(R.string.vv_c_visit_remove)) { holder.removeBullet(bullet.id) }
    }
}

private const val FIELD = 48
private const val CAPSULE = 999
private const val CAPSULE_HEIGHT = 52
private const val TAG_WIDTH = 76
