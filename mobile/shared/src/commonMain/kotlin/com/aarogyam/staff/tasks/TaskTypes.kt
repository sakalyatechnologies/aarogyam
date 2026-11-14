package com.aarogyam.staff.tasks

/** What finishing a task asks of the person. */
enum class TaskAction {
    None,
    RecordUsage,
    ConfirmPhotos,
    ;

    companion object {
        /** An action this build does not know acts like [None]: the plain Done button. */
        fun of(wire: String): TaskAction =
            when (wire) {
                "record_usage" -> RecordUsage
                "confirm_photos" -> ConfirmPhotos
                else -> None
            }
    }
}

/** One material line for a `record_usage` task. */
data class UsageLine(
    val itemId: String,
    val quantity: Long,
)
