package com.aarogyam.staff.android.ui

import androidx.annotation.StringRes
import com.aarogyam.staff.android.R
import com.aarogyam.staff.notes.NoteSection
import com.aarogyam.staff.notes.NoteStatus
import com.aarogyam.staff.notes.VisitNoteView
import com.sakalya.mobile.designcompose.SkTone

@StringRes
internal fun VisitNoteView.kindLabel(): Int =
    when (kind) {
        "progress" -> R.string.notes_kind_progress
        "procedure" -> R.string.notes_kind_procedure
        "intake" -> R.string.notes_kind_intake
        "front_desk" -> R.string.notes_kind_front_desk
        else -> R.string.notes_kind_soap
    }

@StringRes
internal fun NoteSection.label(): Int =
    when (this) {
        NoteSection.Subjective -> R.string.notes_section_subjective
        NoteSection.Objective -> R.string.notes_section_objective
        NoteSection.Assessment -> R.string.notes_section_assessment
        NoteSection.Plan -> R.string.notes_section_plan
    }

@StringRes
internal fun NoteStatus.label(): Int =
    when (this) {
        NoteStatus.Draft -> R.string.notes_status_draft
        NoteStatus.Signed -> R.string.notes_status_signed
        NoteStatus.Conflict -> R.string.notes_status_conflict
        NoteStatus.EnteredInError -> R.string.notes_status_error
        NoteStatus.Unknown -> R.string.notes_status_unknown
    }

internal fun NoteStatus.tone(): SkTone =
    when (this) {
        NoteStatus.Signed -> SkTone.Success
        NoteStatus.Draft -> SkTone.Warning
        NoteStatus.Conflict, NoteStatus.EnteredInError -> SkTone.Danger
        NoteStatus.Unknown -> SkTone.Neutral
    }
