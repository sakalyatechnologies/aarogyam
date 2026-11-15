package com.aarogyam.staff.team

import com.aarogyam.staff.api.model.ChatMessage

/** A message's file. [image] when it can be shown as a picture; an empty [id] is a photo still being sent. */
data class AttachmentView(
    val id: String,
    val image: Boolean,
    val fileName: String?,
    val sizeBytes: Long,
)

/** A short-lived link to a file the screen opens at once. It is never logged or kept past [ChatThreadStateHolder.closeLink]. */
data class AttachmentLink(
    val url: String,
    val image: Boolean,
    val fileName: String?,
)

/** The kinds of conversation the server names. */
internal object ChatKind {
    const val GROUP = "group"
    const val CHANNEL = "channel"
}

internal fun ChatMessage.toView(me: String) =
    MessageView(
        id = id,
        clientId = clientId,
        mine = authorMembershipId == me,
        author = authorName,
        body = body,
        at = createdAt,
        deleted = deleted,
        notice = isNotice == true,
        attachment =
            attachment?.let {
                AttachmentView(it.id, it.mimeType.startsWith("image/"), it.fileName, it.sizeBytes)
            },
    )
