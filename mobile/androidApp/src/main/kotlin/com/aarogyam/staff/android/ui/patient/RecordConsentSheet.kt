package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.consents.ConsentMethod
import com.aarogyam.staff.consents.ConsentPurpose
import com.aarogyam.staff.consents.ConsentsState
import com.aarogyam.staff.consents.ConsentsStateHolder
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** "Record a consent": what for, how it was given, an optional note; the current notice is shown first. */
@Composable
internal fun RecordConsentSheet(
    holder: ConsentsStateHolder,
    loaded: ConsentsState.Loaded,
    onDone: () -> Unit,
) {
    val p = SkTheme.palette
    val failed = loaded.failedRecord
    var purpose by remember { mutableStateOf(failed?.purpose ?: ConsentPurpose.Care) }
    var method by remember { mutableStateOf(failed?.method ?: ConsentMethod.Verbal) }
    var note by remember { mutableStateOf(failed?.note.orEmpty()) }
    var sent by remember { mutableStateOf(false) }
    // The sheet closes once the record went through: it was busy, and now there is no failure.
    LaunchedEffect(loaded.busy) {
        if (sent && !loaded.busy && loaded.failedRecord == null && loaded.error == null) onDone()
    }
    val purposes = ConsentPurpose.entries
    val purposeTitles = purposes.associateWith { it.title() }
    val methods = ConsentMethod.entries
    val methodTitles = methods.associateWith { it.title() }
    SkModalSheet(
        title = stringResource(R.string.p9_consent_record),
        subtitle = stringResource(R.string.p9_consent_record_sub),
        onDismiss = onDone,
    ) {
        loaded.notices.maxByOrNull { it.version }?.let { notice ->
            Column(
                Modifier.fillMaxWidth().background(p.surface2.color, RoundedCornerShape(16.dp)).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(notice.label, style = v7(13f, FontWeight.Bold), color = p.onSurface.color)
                Text(notice.body, style = v7(12.5f), color = p.onSurfaceVariant.color)
            }
        }
        V7Label(stringResource(R.string.p9_consent_for))
        SkChoiceChips(purposes, setOf(purpose), { purpose = it }, { purposeTitles.getValue(it) })
        V7Label(stringResource(R.string.p9_consent_how))
        SkChoiceChips(methods, setOf(method), { method = it }, { methodTitles.getValue(it) })
        SkField(stringResource(R.string.p9_consent_note), note, { note = it })
        (loaded.failedRecord?.error ?: loaded.error)?.let {
            Text(stringResource(it.message()), style = v7(12.5f, FontWeight.SemiBold), color = p.error.color)
        }
        SkPillButton(
            stringResource(R.string.p9_consent_save),
            {
                sent = true
                holder.record(purpose, method, note.ifEmpty { null })
            },
            wide = true,
            loading = loaded.busy,
        )
    }
}
