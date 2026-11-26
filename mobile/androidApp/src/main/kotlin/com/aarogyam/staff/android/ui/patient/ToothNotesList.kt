package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.display
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.chart.ToothSheetStateHolder
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The tooth's past notes, newest first, each with who wrote it and when. */
@Composable
internal fun ToothNotesList(sheet: ToothSheetStateHolder) {
    val notes by sheet.toothNotes.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        notes.items.forEach { note ->
            val who = listOfNotNull(note.by, note.at?.date?.display()).joinToString(" · ")
            Column(verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(note.body, style = v7(14f), color = SkTheme.palette.onSurface.color)
                if (who.isNotEmpty()) V7Muted(who)
            }
        }
        notes.error?.let {
            Text(
                stringResource(R.string.pv_tooth_health_failed) + " " + stringResource(it.message()),
                style = v7(12.5f, FontWeight.SemiBold),
                color = SkTheme.palette.error.color,
            )
        }
    }
}
