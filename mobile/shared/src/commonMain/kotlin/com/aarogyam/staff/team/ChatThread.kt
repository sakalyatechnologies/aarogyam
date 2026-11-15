package com.aarogyam.staff.team

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.chatAttachmentLink
import com.aarogyam.staff.api.conversation
import com.aarogyam.staff.api.markRead
import com.aarogyam.staff.api.messages
import com.aarogyam.staff.api.model.NewChatMessageBody
import com.aarogyam.staff.api.postChatAttachment
import com.aarogyam.staff.api.postMessage
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.IdempotencyKey
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One message bubble. [pending] while it is on its way; [failed] when the send did not go through.
 * A [notice] is pinned in its conversation; an [attachment] is the file it carries.
 */
data class MessageView(
    val id: String,
    val clientId: String,
    val mine: Boolean,
    val author: String?,
    val body: String?,
    val at: String,
    val deleted: Boolean,
    val pending: Boolean = false,
    val failed: Boolean = false,
    val notice: Boolean = false,
    val attachment: AttachmentView? = null,
)

data class ThreadState(
    val loading: Boolean = true,
    val messages: List<MessageView> = emptyList(),
    val draft: String = "",
    val error: ScreenError? = null,
    /** The newest notice, shown as a banner above the messages. */
    val pinned: MessageView? = null,
    /** The clinic-wide "Everyone" channel. */
    val channel: Boolean = false,
    /** Whether add, remove and leave are offered: false for direct chats and the channel. */
    val canManageMembers: Boolean = false,
    /** The caller holds `chat.notice`, so the composer offers "Post as notice". */
    val canNotice: Boolean = false,
    /** The toggle: the next text message is posted as a notice. */
    val notice: Boolean = false,
    /** A photo was not sent because it is over [ChatLimits.MAX_FILE_BYTES]. */
    val refused: Boolean = false,
    /** A file link is being fetched. */
    val opening: Boolean = false,
    /** The link to show or open now; clear it with [ChatThreadStateHolder.closeLink]. */
    val link: AttachmentLink? = null,
    /** The link could not be fetched. */
    val linkFailed: Boolean = false,
    /** Thumbnail links of image attachments by file id (fetched by [ChatThreadStateHolder.requestThumb]); never logged. */
    val thumbs: Map<String, String> = emptyMap(),
)

object ChatLimits {
    const val MAX_FILE_BYTES = 5 * 1024 * 1024
}

/**
 * One conversation: the latest page, then polling with `after` the newest id. A sent message shows
 * at once; its client id makes a resend safe, so a failed one can be retried with [retry].
 */
class ChatThreadStateHolder(
    private val clinic: ClinicContext,
    private val conversationId: String,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.chat"),
) {
    private val me = clinic.session.membership.id
    private val mutableState =
        MutableStateFlow(ThreadState(canNotice = "chat.notice" in clinic.permissions))
    val state: StateFlow<ThreadState> = mutableState.asStateFlow()

    /** The JPEG of each photo bubble that has not been sent yet, by client id, for a retry. */
    private val photos = mutableMapOf<String, ByteArray>()
    private val thumbsAsked = mutableSetOf<String>()

    init {
        scope.launch { load(after = null) }
        scope.launch { loadConversation() }
    }

    /** Fetches messages newer than the last one shown (the screen calls this on its poll). */
    fun poll() {
        val newest =
            mutableState.value.messages
                .lastOrNull { !it.pending && !it.failed }
                ?.id
        scope.launch { load(after = newest) }
    }

    fun setDraft(text: String) = mutableState.update { it.copy(draft = text.take(MAX_BODY)) }

    /** The "Post as notice" toggle; ignored without `chat.notice`. */
    fun setNotice(on: Boolean) = mutableState.update { it.copy(notice = on && it.canNotice) }

    fun send() {
        val s = mutableState.value
        val text = s.draft.trim()
        if (text.isEmpty()) return
        val clientId = IdempotencyKey.generate().toString()
        val bubble =
            MessageView(
                "local-$clientId",
                clientId,
                true,
                null,
                text,
                "",
                deleted = false,
                pending = true,
                notice = s.notice && s.canNotice,
            )
        mutableState.update { it.copy(draft = "", notice = false, messages = it.messages + bubble) }
        post(bubble)
    }

    /** Sends [jpeg] (already resized on the phone) as a photo message, the draft text as its caption; it shows at once as sending. */
    fun sendPhoto(jpeg: ByteArray) {
        if (jpeg.isEmpty()) return
        if (jpeg.size > ChatLimits.MAX_FILE_BYTES) {
            mutableState.update { it.copy(refused = true) }
            return
        }
        val clientId = IdempotencyKey.generate().toString()
        val caption =
            mutableState.value.draft
                .trim()
                .ifEmpty { null }
        val bubble =
            MessageView(
                "local-$clientId",
                clientId,
                true,
                null,
                caption,
                "",
                deleted = false,
                pending = true,
                attachment = AttachmentView("", true, null, jpeg.size.toLong()),
            )
        photos[clientId] = jpeg
        mutableState.update { it.copy(draft = "", messages = it.messages + bubble) }
        post(bubble)
    }

    fun dismissRefused() = mutableState.update { it.copy(refused = false) }

    fun retry(clientId: String) {
        val bubble = mutableState.value.messages.firstOrNull { it.clientId == clientId && it.failed } ?: return
        replace(bubble.copy(failed = false, pending = true))
        post(bubble)
    }

    /** Gets a five-minute link for the file of [attachmentId]; the screen shows or opens [ThreadState.link]. */
    fun openAttachment(attachmentId: String) {
        if (attachmentId.isEmpty() || mutableState.value.opening) return
        val s = mutableState.value
        val known =
            (s.messages + listOfNotNull(s.pinned)).firstNotNullOfOrNull { m ->
                m.attachment?.takeIf {
                    it.id ==
                        attachmentId
                }
            }
        mutableState.update { it.copy(opening = true, linkFailed = false) }
        scope.launch {
            when (val answer = clinic.api.chatAttachmentLink(attachmentId)) {
                is Outcome.Success -> {
                    val url = absolute(answer.value.url)
                    mutableState.update {
                        it.copy(opening = false, link = AttachmentLink(url, known?.image ?: false, known?.fileName))
                    }
                }

                is Outcome.Failure -> {
                    log.warn("chat.link_failed") {
                        id("conversation", conversationId)
                        code("error", answer.error.code.value)
                    }
                    mutableState.update { it.copy(opening = false, linkFailed = true) }
                }
            }
        }
    }

    /** Fetches the thumbnail link of an image file once; the screen reads it from [ThreadState.thumbs]. */
    fun requestThumb(attachmentId: String) {
        if (attachmentId.isEmpty() || attachmentId in mutableState.value.thumbs ||
            !thumbsAsked.add(attachmentId)
        ) {
            return
        }
        scope.launch {
            when (val answer = clinic.api.chatAttachmentLink(attachmentId)) {
                is Outcome.Success -> {
                    val url = absolute(answer.value.url)
                    mutableState.update { it.copy(thumbs = it.thumbs + (attachmentId to url)) }
                }

                is Outcome.Failure -> {
                    thumbsAsked.remove(attachmentId)
                    log.warn("chat.thumb_failed") { code("error", answer.error.code.value) }
                }
            }
        }
    }

    private fun absolute(path: String) = if (path.startsWith("/")) clinic.api.origin + path else path

    fun closeLink() = mutableState.update { it.copy(link = null, linkFailed = false) }

    private fun post(bubble: MessageView) {
        scope.launch {
            val jpeg = photos[bubble.clientId]
            val answer =
                if (jpeg != null) {
                    clinic.api.postChatAttachment(conversationId, bubble.clientId, jpeg, bubble.body)
                } else {
                    clinic.api.postMessage(
                        conversationId,
                        NewChatMessageBody(
                            clientId = bubble.clientId,
                            body = bubble.body.orEmpty(),
                            isNotice = bubble.notice.takeIf { it },
                        ),
                    )
                }
            when (answer) {
                is Outcome.Success -> {
                    photos.remove(bubble.clientId)
                    val view = answer.value.toView(me)
                    replace(view)
                    if (view.notice) mutableState.update { it.copy(pinned = view) }
                }

                is Outcome.Failure -> {
                    log.warn("chat.send_failed") {
                        id("conversation", conversationId)
                        code("error", answer.error.code.value)
                    }
                    replace(bubble.copy(pending = false, failed = true))
                }
            }
        }
    }

    private suspend fun loadConversation() {
        when (val answer = clinic.api.conversation(conversationId)) {
            is Outcome.Success -> {
                mutableState.update {
                    it.copy(
                        pinned = answer.value.pinnedNotice?.toView(me),
                        channel = answer.value.kind == ChatKind.CHANNEL,
                        canManageMembers = answer.value.kind == ChatKind.GROUP,
                    )
                }
            }

            is Outcome.Failure -> {
                log.warn("chat.conversation_failed") {
                    id("conversation", conversationId)
                    code("error", answer.error.code.value)
                }
            }
        }
    }

    private suspend fun load(after: String?) {
        when (val answer = clinic.api.messages(conversationId, after = after)) {
            is Outcome.Success -> {
                val fresh =
                    answer.value.items
                        .map { it.toView(me) }
                        .sortedBy { it.at }
                var newNotice = false
                mutableState.update { s ->
                    val known = s.messages.map { it.clientId }.toSet()
                    newNotice = fresh.any { it.notice && it.clientId !in known }
                    val merged = (
                        s.messages.map { m -> fresh.firstOrNull { it.clientId == m.clientId } ?: m } +
                            fresh.filter { it.clientId !in known }
                    )
                    s.copy(loading = false, messages = merged, error = null)
                }
                if (newNotice) loadConversation()
                fresh.lastOrNull()?.let { clinic.api.markRead(conversationId, it.id) }
            }

            is Outcome.Failure -> {
                log.warn("chat.load_failed") {
                    id("conversation", conversationId)
                    code("error", answer.error.code.value)
                }
                mutableState.update { it.copy(loading = false, error = ScreenError.of(answer.error)) }
            }
        }
    }

    private fun replace(view: MessageView) =
        mutableState.update { s ->
            s.copy(messages = s.messages.map { if (it.clientId == view.clientId) view else it })
        }

    private companion object {
        const val MAX_BODY = 4000
    }
}
