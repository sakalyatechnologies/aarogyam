package com.aarogyam.patient.android.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.patient.android.R
import com.aarogyam.patient.files.FileKind
import com.aarogyam.patient.files.FileView
import com.aarogyam.patient.files.FilesStateHolder
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkListRow
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTopBar
import com.sakalya.mobile.designcompose.color

/** Files the clinics shared: tap an image or a PDF to read it here. */
@Composable
fun FilesScreen(
    holder: FilesStateHolder,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val opened = state.opened
    if (opened != null) {
        BackHandler(onBack = holder::close)
        Column(Modifier.fillMaxSize()) {
            SkTopBar(
                opened.file.title(),
                navigation = {
                    BarAction(
                        stringResource(R.string.done),
                        SkTheme.colors.onPrimary.color,
                        holder::close,
                    )
                },
            )
            when (opened.file.kind) {
                FileKind.Pdf -> PdfPages(opened.path)
                else -> ZoomableImage(opened.path)
            }
        }
        return
    }
    PatientScreen(stringResource(R.string.files_title), onBack = onBack) {
        state.error?.let { error -> item { ErrorState(error, holder::refresh) } }
        state.openError?.let { error -> item { SkCard { BodyText(stringResource(error.message())) } } }
        if (state.loading) item { LoadingIndicator() }
        if (!state.loading && state.error == null && state.files.isEmpty()) {
            item { SkCard { BodyText(stringResource(R.string.files_empty), muted = true) } }
        }
        item {
            SkCard {
                Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    state.files.forEach { file ->
                        val opening = state.opening == file.id
                        SkListRow(
                            file.title(),
                            subtitle = file.subtitle(),
                            trailing = {
                                BodyText(
                                    when {
                                        opening -> stringResource(R.string.files_opening)
                                        file.kind == FileKind.Other -> stringResource(R.string.files_cant_open)
                                        else -> ""
                                    },
                                    muted = true,
                                )
                            },
                            onClick = { holder.open(file) },
                        )
                    }
                }
            }
        }
        item { Spacer(Modifier.height(0.dp)) }
    }
}

@StringRes
private fun String.categoryLabel(): Int =
    when (this) {
        "xray" -> R.string.file_xray
        "photo" -> R.string.file_photo
        "report" -> R.string.file_report
        "consent" -> R.string.file_consent
        else -> R.string.file_document
    }

@Composable
private fun FileView.title(): String = label ?: caption ?: stringResource(category.categoryLabel())

@Composable
private fun FileView.subtitle(): String = "$clinicName · ${(takenAt ?: createdAt)?.date().orEmpty()}"
