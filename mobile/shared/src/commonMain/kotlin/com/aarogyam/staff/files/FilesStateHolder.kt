package com.aarogyam.staff.files

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.Attachment
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.outbox.Queued
import com.aarogyam.staff.outbox.WriteQueue
import com.aarogyam.staff.outbox.shouldQueue
import com.aarogyam.staff.patients.ClinicMoment
import com.aarogyam.staff.patients.moment
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One file in the gallery. The bytes come from [FilesStateHolder.preview] when the screen needs them. */
data class FileView(
    val id: String,
    /** Null when the file has no label. */
    val label: String?,
    val isImage: Boolean,
    val tooth: Int?,
    val at: ClinicMoment?,
)

/** The files that share a label; a null [label] is the unlabelled group, last. */
data class LabelGroup(
    val label: String?,
    val files: List<FileView>,
)

/** Why a photo wasn't sent. Nothing leaves the phone for these. */
enum class UploadProblem { LabelTooLong, BadTooth, TooLarge, Failed }

sealed interface FilesState {
    data object Loading : FilesState

    /** The role lacks `clinical.read`; nothing was requested. */
    data object NotAllowed : FilesState

    data class Failed(
        val error: ScreenError,
    ) : FilesState

    data class Loaded(
        val groups: List<LabelGroup>,
        /** The role holds `clinical.write`. */
        val canUpload: Boolean,
        val uploading: Boolean = false,
        val refreshing: Boolean = false,
        val problem: UploadProblem? = null,
        val error: ScreenError? = null,
        /** Photos saved on this phone and not yet sent ("Saved, will send"). */
        val pendingSync: Int = 0,
        /** The last photo was refused: too many unsent photos are stored. Send or discard some first. */
        val queueFull: Boolean = false,
    ) : FilesState
}

/**
 * A patient's files for Patient 360: the gallery grouped by label, and uploads of photos the
 * screen has already resized. Viewing needs `clinical.read` (the API narrows it to the member's own
 * or assigned patients), uploading `clinical.write`. Nothing but ids and codes is logged.
 */
class FilesStateHolder(
    private val clinic: ClinicContext,
    private val patientId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.files"),
    /** Saves a photo for later when offline; null keeps uploads online-only. */
    private val writes: WriteQueue? = null,
) {
    private val mutableState = MutableStateFlow<FilesState>(FilesState.Loading)

    /** What the screen draws. */
    val state: StateFlow<FilesState> = mutableState.asStateFlow()

    // One id per submission, kept until it succeeds, so a retry cannot store the photo twice.
    private var pendingId: String? = null

    private val canUpload = WRITE in clinic.permissions
    private val queuedIds = mutableSetOf<String>()

    init {
        if (READ in clinic.permissions) refresh() else mutableState.value = FilesState.NotAllowed
        writes?.let { w ->
            scope.launch {
                var before = 0
                w.runner.ids.collect { ids ->
                    val waiting = queuedIds.count { it in ids }
                    (mutableState.value as? FilesState.Loaded)?.let {
                        mutableState.value =
                            it.copy(pendingSync = waiting)
                    }
                    // A queued photo reached the server: the gallery has it now.
                    if (waiting < before) refresh()
                    before = waiting
                }
            }
        }
    }

    /** Reloads the gallery, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        if (current == FilesState.NotAllowed || (current is FilesState.Loaded && current.refreshing)) return
        if (current is FilesState.Loaded) mutableState.value = current.copy(refreshing = true, error = null)
        scope.launch {
            when (val result = clinic.api.attachments(patientId)) {
                is Outcome.Success -> {
                    val previous = mutableState.value as? FilesState.Loaded
                    mutableState.value =
                        FilesState.Loaded(
                            groups = group(result.value.items.map { it.toView() }),
                            canUpload = canUpload,
                            uploading = previous?.uploading ?: false,
                            problem = previous?.problem,
                            pendingSync = previous?.pendingSync ?: 0,
                            queueFull = previous?.queueFull ?: false,
                        )
                }

                is Outcome.Failure -> {
                    log.warn("files.load_failed") {
                        id("patient", patientId)
                        code("error", result.error.code.value)
                    }
                    val error = ScreenError.of(result.error)
                    mutableState.value =
                        if (current is FilesState.Loaded) {
                            current.copy(refreshing = false, error = error)
                        } else {
                            FilesState.Failed(error)
                        }
                }
            }
        }
    }

    /**
     * Sends a JPEG the platform already resized to at most [PhotoLimits.MAX_EDGE]. [label] and
     * [tooth] are optional and checked first.
     */
    fun upload(
        jpeg: ByteArray,
        label: String?,
        tooth: Int?,
    ) {
        val current = mutableState.value as? FilesState.Loaded ?: return
        if (!canUpload || current.uploading) return
        val clean = cleanLabel(label)
        val problem =
            when {
                clean != null && clean.length > MAX_LABEL_LENGTH -> UploadProblem.LabelTooLong
                tooth != null && !isFdiTooth(tooth) -> UploadProblem.BadTooth
                jpeg.isEmpty() || jpeg.size > PhotoLimits.MAX_BYTES -> UploadProblem.TooLarge
                else -> null
            }
        if (problem != null) {
            mutableState.value = current.copy(problem = problem)
            return
        }
        val id = pendingId ?: IdempotencyKey.generate().toString().also { pendingId = it }
        mutableState.value = current.copy(uploading = true, problem = null, queueFull = false)
        if (writes != null && !writes.online) return queuePhoto(writes, id, jpeg, clean, tooth)
        scope.launch {
            when (val result = clinic.api.uploadAttachment(patientId, id, kindFor(clean), jpeg, clean, tooth)) {
                is Outcome.Success -> {
                    pendingId = null
                    log.info("files.uploaded") { id("attachment", result.value.id) }
                    mutableState.value = (mutableState.value as? FilesState.Loaded)?.copy(uploading = false) ?: current
                    refresh()
                }

                is Outcome.Failure -> {
                    if (writes != null &&
                        result.error.shouldQueue()
                    ) {
                        return@launch queuePhoto(writes, id, jpeg, clean, tooth)
                    }
                    log.warn("files.upload_failed") {
                        id("patient", patientId)
                        code("error", result.error.code.value)
                    }
                    val now = mutableState.value as? FilesState.Loaded ?: current
                    mutableState.value = now.copy(uploading = false, problem = UploadProblem.Failed)
                }
            }
        }
    }

    /** Keeps the photo on the phone, beside the queue, until it is sent; the same id is used when it goes. */
    private fun queuePhoto(
        w: WriteQueue,
        id: String,
        jpeg: ByteArray,
        label: String?,
        tooth: Int?,
    ) {
        val now = mutableState.value as? FilesState.Loaded ?: return
        when (val queued = w.photo(clinic.slug, patientId, id, jpeg, label, tooth)) {
            is Queued.Saved -> {
                pendingId = null
                queuedIds += queued.id
                mutableState.value =
                    now.copy(uploading = false, pendingSync = queuedIds.count { it in w.runner.ids.value })
            }

            is Queued.Refused -> {
                log.warn("files.not_queued") { code("why", queued.why.name) }
                mutableState.value = now.copy(uploading = false, queueFull = true)
            }
        }
    }

    /** Clears the upload problem once the person has seen it. */
    fun dismissProblem() {
        val current = mutableState.value as? FilesState.Loaded ?: return
        mutableState.value = current.copy(problem = null, queueFull = false)
    }

    /** A picture's bytes for the gallery, fetched through a short-lived link; null when it can't be had. */
    suspend fun preview(id: String): ByteArray? = (clinic.api.attachmentBytes(id) as? Outcome.Success)?.value

    private fun Attachment.toView() =
        FileView(
            id = id,
            label = label?.trim()?.takeIf { it.isNotEmpty() },
            isImage = mimeType.startsWith("image/"),
            tooth = tooth,
            at = moment(createdAt, clinic.timeZone),
        )

    private companion object {
        const val READ = "clinical.read"
        const val WRITE = "clinical.write"
    }
}

/** Preset labels first, then the clinic's own in order of appearance, unlabelled last. */
internal fun group(files: List<FileView>): List<LabelGroup> {
    fun rank(label: String?): Int =
        when {
            label == null -> PRESET_LABELS.size + 1
            label in PRESET_LABELS -> PRESET_LABELS.indexOf(label)
            else -> PRESET_LABELS.size
        }
    return files
        .groupBy { it.label }
        .map { (label, items) -> LabelGroup(label, items) }
        .sortedBy { rank(it.label) }
}
