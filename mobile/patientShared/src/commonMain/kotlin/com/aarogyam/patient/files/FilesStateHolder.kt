package com.aarogyam.patient.files

import com.aarogyam.patient.ClinicTime
import com.aarogyam.patient.PatientDirectory
import com.aarogyam.patient.ScreenError
import com.aarogyam.patient.api.model.PatientFile
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** How the app can show a file: in the image viewer, the PDF viewer, or not at all. */
enum class FileKind {
    Image,
    Pdf,
    Other,
    ;

    companion object {
        fun of(mimeType: String): FileKind =
            when {
                mimeType.lowercase() in IMAGES -> Image
                mimeType.lowercase() == "application/pdf" -> Pdf
                else -> Other
            }

        private val IMAGES = setOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/heic")
    }
}

/** A file a clinic shared; [category] is the API's `kind` (`xray`, `report`), for platform copy. */
data class FileView(
    val id: String,
    val clinicId: String,
    val clinicName: String,
    val category: String,
    val label: String?,
    val caption: String?,
    val mimeType: String,
    val sizeBytes: Long,
    val takenAt: ClinicTime?,
    val createdAt: ClinicTime?,
    val kind: FileKind,
)

/** A downloaded copy in the cache directory, ready for the viewer; [path] is a local file. */
data class OpenedFile(
    val file: FileView,
    val path: String,
)

/**
 * Where downloaded copies live: the platform's cache directory only, never backed up or shared.
 * [save] returns the local path, or null when it could not be written.
 */
interface FileCache {
    fun save(
        name: String,
        bytes: ByteArray,
    ): String?

    /** Deletes every copy. */
    fun clear()
}

/** The files screen: the shared files, and the one being opened or viewed. */
data class FilesState(
    val loading: Boolean = true,
    val files: List<FileView> = emptyList(),
    val error: ScreenError? = null,
    val opening: String? = null,
    val opened: OpenedFile? = null,
    val openError: ScreenError? = null,
)

/**
 * Files the clinics shared (`GET /me/patient/files`) and opening one: the bytes come from the
 * owning clinic's host (`GET /me/patient/files/{id}/content`, with the session token, no signed
 * URL) into the [cache]. Nothing about a file but its id is logged.
 */
class FilesStateHolder(
    private val directory: PatientDirectory,
    private val scope: CoroutineScope,
    private val cache: FileCache,
    private val log: Logger = Logger("aarogyam.patient.files"),
) {
    private val mutableState = MutableStateFlow(FilesState())

    /** The current screen state. */
    val state: StateFlow<FilesState> = mutableState.asStateFlow()

    init {
        cache.clear()
        refresh()
    }

    /** Reloads the list. */
    fun refresh() {
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            val api =
                when (val found = directory.app()) {
                    is Outcome.Success -> found.value
                    is Outcome.Failure -> return@launch fail(ScreenError.of(found.error))
                }
            val names =
                (directory.load() as? Outcome.Success)
                    ?.value
                    ?.clinics
                    ?.associate { it.clinicId to it.name }
                    .orEmpty()
            when (val body = api.files()) {
                is Outcome.Success -> {
                    mutableState.update {
                        it.copy(
                            loading = false,
                            files =
                                body.value.items.map { f ->
                                    f.view(names[f.clinicId].orEmpty())
                                },
                        )
                    }
                }

                is Outcome.Failure -> {
                    fail(ScreenError.of(body.error))
                }
            }
        }
    }

    /** Downloads [file] into the cache and, when it is an image or a PDF, shows it. */
    fun open(file: FileView) {
        if (file.kind == FileKind.Other || mutableState.value.opening != null) return
        mutableState.update { it.copy(opening = file.id, openError = null) }
        scope.launch {
            val api = directory.clinic(file.clinicId)?.let(directory::clinicApi)
            if (api == null) return@launch failOpen(ScreenError.NotFound)
            when (val bytes = api.fileContent(file.id)) {
                is Outcome.Success -> {
                    val path = cache.save(cacheName(file), bytes.value)
                    if (path == null) {
                        failOpen(ScreenError.Unknown)
                    } else {
                        log.info("patient.file_opened") { id("file", file.id) }
                        mutableState.update { it.copy(opening = null, opened = OpenedFile(file, path)) }
                    }
                }

                is Outcome.Failure -> {
                    failOpen(ScreenError.of(bytes.error))
                }
            }
        }
    }

    /** Closes the viewer and deletes the downloaded copy. */
    fun close() {
        cache.clear()
        mutableState.update { it.copy(opened = null) }
    }

    private fun fail(error: ScreenError) = mutableState.update { it.copy(loading = false, error = error) }

    private fun failOpen(error: ScreenError) = mutableState.update { it.copy(opening = null, openError = error) }

    private fun cacheName(file: FileView): String {
        val extension = if (file.kind == FileKind.Pdf) "pdf" else "img"
        return file.id.filter { it.isLetterOrDigit() || it == '-' } + "." + extension
    }

    private fun PatientFile.view(clinicName: String) =
        FileView(
            id = id,
            clinicId = clinicId,
            clinicName = clinicName,
            category = kind,
            label = label,
            caption = caption,
            mimeType = mimeType,
            sizeBytes = sizeBytes,
            takenAt = ClinicTime.parse(takenAt),
            createdAt = ClinicTime.parse(createdAt),
            kind = FileKind.of(mimeType),
        )
}
