package com.aarogyam.staff.android.ui

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.notes.NoteSection
import com.aarogyam.staff.notes.NoteStatus
import com.aarogyam.staff.notes.PatientNotesState
import com.aarogyam.staff.notes.PatientNotesStateHolder
import com.aarogyam.staff.notes.SaveProblem
import com.aarogyam.staff.notes.SummaryEditor
import com.aarogyam.staff.notes.SummaryView
import com.aarogyam.staff.notes.VisitNoteView
import com.aarogyam.staff.richtext.Format
import com.aarogyam.staff.richtext.RichText
import com.aarogyam.staff.richtext.RichTextProblem
import com.aarogyam.staff.richtext.applyFormat
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkChip
import com.sakalya.mobile.designcompose.SkEmptyState
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTone
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The Notes tab of Patient 360: the patient's summary note (editable with `clinical.write`), then the visit notes. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotesTab(holder: PatientNotesStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    PullToRefreshBox(
        isRefreshing = (state as? PatientNotesState.Loaded)?.refreshing == true,
        onRefresh = holder::refresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        when (val current = state) {
            PatientNotesState.Loading -> {
                LoadingIndicator()
            }

            PatientNotesState.NotAllowed -> {
                SkEmptyState(stringResource(R.string.patient_tab_notes), stringResource(R.string.notes_not_allowed))
            }

            is PatientNotesState.Failed -> {
                SkEmptyState(
                    stringResource(R.string.patient_tab_notes),
                    stringResource(current.error.message()),
                    actionLabel = stringResource(R.string.try_again),
                    onAction = holder::refresh,
                )
            }

            is PatientNotesState.Loaded -> {
                NotesList(current, holder)
            }
        }
    }
}

@Composable
private fun NotesList(
    state: PatientNotesState.Loaded,
    holder: PatientNotesStateHolder,
) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(Spacing.ML.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp),
    ) {
        state.error?.let { error ->
            item {
                Text(
                    stringResource(error.message()),
                    style = SkTypography.footnote,
                    color = SkTheme.colors.dangerText.color,
                )
            }
        }
        item {
            SkCard {
                Text(
                    stringResource(R.string.notes_summary_title),
                    style = SkTypography.headline,
                    color = SkTheme.colors.text.color,
                )
                val editor = state.editor
                if (editor != null) {
                    SummaryEditorForm(editor, holder)
                } else {
                    SummaryBody(state.summary, state.canEdit, holder::startEditing)
                }
            }
        }
        item {
            Text(
                stringResource(R.string.notes_visits_title),
                style = SkTypography.headline,
                color = SkTheme.colors.text.color,
            )
        }
        if (state.visitNotes.isEmpty()) {
            item { Muted(stringResource(R.string.notes_visits_none)) }
        }
        items(state.visitNotes, key = { it.id }) { VisitNoteCard(it) }
    }
}

@Composable
private fun SummaryBody(
    summary: SummaryView?,
    canEdit: Boolean,
    onEdit: () -> Unit,
) {
    Column(Modifier.padding(top = Spacing.SM.dp)) {
        if (summary == null || summary.body.isBlank()) {
            Muted(stringResource(R.string.notes_summary_empty))
        } else {
            RichTextView(summary.body)
            val by = summary.updatedBy
            val at = summary.updatedAt
            if (at != null) {
                Muted(
                    if (by == null) {
                        stringResource(R.string.notes_updated, "${at.date.display()} · ${at.time.display()}")
                    } else {
                        stringResource(R.string.notes_updated_by, "${at.date.display()} · ${at.time.display()}", by)
                    },
                )
            }
        }
        if (canEdit) {
            SkButton(
                stringResource(if (summary == null) R.string.notes_write else R.string.notes_edit),
                onClick = onEdit,
                variant = SkButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.SM.dp),
            )
        }
    }
}

/** The formatted editor: a small toolbar over a text box whose selection the toolbar acts on. */
@Composable
private fun SummaryEditorForm(
    editor: SummaryEditor,
    holder: PatientNotesStateHolder,
) {
    var field by remember { mutableStateOf(TextFieldValue(editor.text, TextRange(editor.text.length))) }
    Column(Modifier.padding(top = Spacing.SM.dp), verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        Row {
            FORMATS.forEach { (format, label, description) ->
                val words = stringResource(description)
                TextButton(
                    onClick = {
                        val done = applyFormat(field.text, field.selection.min, field.selection.max, format)
                        field = TextFieldValue(done.value, TextRange(done.start, done.end))
                        holder.edit(done.value)
                    },
                    modifier = Modifier.semantics { contentDescription = words },
                ) { Text(label) }
            }
        }
        OutlinedTextField(
            value = field,
            onValueChange = {
                field = it
                holder.edit(it.text)
            },
            label = { Text(stringResource(R.string.notes_summary_title)) },
            minLines = 6,
            enabled = !editor.saving,
            modifier = Modifier.fillMaxWidth(),
        )
        problemText(editor)?.let { Text(it, style = SkTypography.footnote, color = SkTheme.colors.dangerText.color) }
        if (editor.text.isNotBlank() && editor.formatProblem == null) {
            Muted(stringResource(R.string.notes_preview))
            RichTextView(editor.text)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
            SkButton(
                stringResource(R.string.notes_cancel),
                onClick = holder::cancelEditing,
                variant = SkButtonVariant.Secondary,
                modifier = Modifier.weight(1f),
            )
            SkButton(
                stringResource(R.string.notes_save),
                onClick = holder::save,
                enabled = editor.canSave,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private val FORMATS =
    listOf(
        Triple(Format.Heading, "H", R.string.notes_fmt_heading),
        Triple(Format.Bold, "B", R.string.notes_fmt_bold),
        Triple(Format.Italic, "I", R.string.notes_fmt_italic),
        Triple(Format.Bullets, "•", R.string.notes_fmt_bullets),
        Triple(Format.Numbers, "1.", R.string.notes_fmt_numbers),
    )

@Composable
private fun problemText(editor: SummaryEditor): String? {
    val problem =
        editor.problem?.let {
            when (it) {
                SaveProblem.Changed -> R.string.notes_problem_changed
                is SaveProblem.Failed -> it.error.message()
                is SaveProblem.Format -> it.problem.message()
            }
        } ?: editor.formatProblem?.message()
    return problem?.let { stringResource(it) }
}

@StringRes
private fun RichTextProblem.message(): Int =
    when (this) {
        RichTextProblem.Html -> R.string.notes_problem_html
        RichTextProblem.LinkOrImage -> R.string.notes_problem_link
        RichTextProblem.Code -> R.string.notes_problem_code
        RichTextProblem.DeepHeading -> R.string.notes_problem_heading
    }

@Composable
private fun VisitNoteCard(note: VisitNoteView) {
    SkCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                listOfNotNull(note.visitNumber, stringResource(note.kindLabel())).joinToString(" · "),
                style = SkTypography.headline,
                color = SkTheme.colors.text.color,
            )
            SkChip(stringResource(note.status.label()), tone = note.status.tone())
        }
        Muted(
            listOfNotNull(
                note.author,
                note.at?.let { "${it.date.display()} · ${it.time.display()}" },
            ).joinToString(" · "),
        )
        note.sections.forEach { section ->
            Column(Modifier.padding(top = Spacing.SM.dp)) {
                Muted(stringResource(section.section.label()))
                RichTextView(section.text)
            }
        }
        if (note.addendaCount > 0) {
            Muted(pluralStringResource(R.plurals.notes_addenda, note.addendaCount, note.addendaCount))
        }
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = SkTypography.footnote, color = SkTheme.colors.textMuted.color)
