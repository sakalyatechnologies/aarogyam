package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.rememberHolder
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.history.CorrectableNote
import com.aarogyam.staff.history.NoteSection
import com.aarogyam.staff.history.NoteVersion
import com.aarogyam.staff.history.NoteVersionsState
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

private val SECTIONS =
    listOf(
        NoteSection.Subjective to R.string.p9_note_s,
        NoteSection.Objective to R.string.p9_note_o,
        NoteSection.Assessment to R.string.p9_note_a,
        NoteSection.Plan to R.string.p9_note_p,
    )

/** "Correct note": the note's four parts to edit, then Sign correction. [onDone] gets whether it was saved. */
@Composable
internal fun NoteCorrectionSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    note: CorrectableNote,
    onDone: (Boolean) -> Unit,
) {
    val holder = rememberHolder { graph.noteCorrection(clinic, note, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    LaunchedEffect(state.saved) { if (state.saved) onDone(true) }
    val error = SkTheme.palette.error.color
    SkModalSheet(stringResource(R.string.p9_note_correct), onDismiss = { onDone(false) }, subtitle = note.author) {
        V7Muted(stringResource(R.string.p9_note_correct_hint))
        SECTIONS.forEach { (section, label) ->
            SkTextField(
                state.text(section),
                { holder.set(section, it) },
                stringResource(label),
                Modifier.fillMaxWidth(),
                singleLine = false,
            )
        }
        if (state.stale) Text(stringResource(R.string.p9_note_correct_stale), style = v7(12.5f), color = error)
        state.error?.let { Text(stringResource(it.message()), style = v7(12.5f), color = error) }
        SkPillButton(
            stringResource(R.string.p9_note_correct_save),
            holder::save,
            wide = true,
            enabled = state.canSave,
            loading = state.saving,
        )
    }
}

/** The versions a correction replaced, newest first. */
@Composable
internal fun NoteVersionsSheet(
    graph: AppGraph,
    clinic: ClinicContext,
    noteId: String,
    onDone: () -> Unit,
) {
    val holder = rememberHolder { graph.noteVersions(clinic, noteId, it) }
    val state by holder.state.collectAsStateWithLifecycle()
    SkModalSheet(stringResource(R.string.p9_note_versions_title), onDismiss = onDone) {
        when (val s = state) {
            NoteVersionsState.Loading -> {
                V7Muted(stringResource(R.string.loading))
            }

            is NoteVersionsState.Failed -> {
                Text(stringResource(s.error.message()), style = v7(12.5f), color = SkTheme.palette.error.color)
                SkPillButton(
                    stringResource(R.string.try_again),
                    holder::refresh,
                    variant = SkPillVariant.Tonal,
                    wide = true,
                )
            }

            is NoteVersionsState.Loaded -> {
                if (s.versions.isEmpty()) V7Muted(stringResource(R.string.p9_note_versions_none))
                s.versions.forEach { Version(it) }
            }
        }
    }
}

@Composable
private fun Version(version: NoteVersion) {
    val p = SkTheme.palette
    val texts =
        listOf(
            R.string.p9_note_s to version.subjective,
            R.string.p9_note_o to version.objective,
            R.string.p9_note_a to version.assessment,
            R.string.p9_note_p to version.plan,
        )
    V7Card {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val at = version.at?.let { it.date.display() + " · " + it.time.display() }
            Text(
                listOfNotNull(version.author, at).joinToString(" · "),
                style = v7(12.5f, FontWeight.Bold),
                color = p.onSurfaceVariant.color,
            )
            texts.forEach { (label, text) ->
                if (text != null) {
                    Text(
                        stringResource(label),
                        style = v7(11f, FontWeight.ExtraBold),
                        color = p.onPrimaryContainer.color,
                    )
                    Text(text, style = v7(14f), color = p.onSurface.color)
                }
            }
        }
    }
}
