package com.aarogyam.staff.team

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.conversations
import com.aarogyam.staff.api.markRead
import com.aarogyam.staff.api.messages
import com.aarogyam.staff.api.model.ChatMessage
import com.aarogyam.staff.api.model.NewChatMessageBody
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

/** One row of the team chat list. Names are for the screen only. */
data class ConversationRow(
    val id: String,
    val group: Boolean,
    /** The group's title, or the other person's name. */
    val title: String,
    val unread: Int,
    val muted: Boolean,
    val lastMessageAt: String?,
)

data class ChatListState(
    val allowed: Boolean,
    val loading: Boolean = false,
    val rows: List<ConversationRow> = emptyList(),
    val error: ScreenError? = null,
)

/** The team chat list (`GET /conversations`), refreshed by the screen's minute poll. */
class ChatListStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.chat"),
) {
    private val mutableState = MutableStateFlow(ChatListState(allowed = CHAT_USE in clinic.permissions))
    val state: StateFlow<ChatListState> = mutableState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        if (!mutableState.value.allowed || mutableState.value.loading) return
        mutableState.update { it.copy(loading = true) }
        scope.launch {
            when (val answer = clinic.api.conversations()) {
                is Outcome.Success -> {
                    val rows =
                        answer.value.items.map {
                            ConversationRow(
                                it.id,
                                it.kind == "group",
                                it.title ?: it.with?.name.orEmpty(),
                                it.unread.toInt(),
                                it.muted,
                                it.lastMessageAt,
                            )
                        }
                    mutableState.update { it.copy(loading = false, rows = rows, error = null) }
                }

                is Outcome.Failure -> {
                    log.warn("chat.list_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(loading = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    internal companion object {
        const val CHAT_USE = "chat.use"
    }
}

/** One message bubble. [pending] while it is on its way; [failed] when the send did not go through. */
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
)

data class ThreadState(
    val loading: Boolean = true,
    val messages: List<MessageView> = emptyList(),
    val draft: String = "",
    val error: ScreenError? = null,
)

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
    private val mutableState = MutableStateFlow(ThreadState())
    val state: StateFlow<ThreadState> = mutableState.asStateFlow()

    init {
        scope.launch { load(after = null) }
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

    fun send() {
        val text = mutableState.value.draft.trim()
        if (text.isEmpty()) return
        val clientId = IdempotencyKey.generate().toString()
        val bubble = MessageView("local-$clientId", clientId, true, null, text, "", deleted = false, pending = true)
        mutableState.update { it.copy(draft = "", messages = it.messages + bubble) }
        post(bubble)
    }

    fun retry(clientId: String) {
        val bubble = mutableState.value.messages.firstOrNull { it.clientId == clientId && it.failed } ?: return
        replace(bubble.copy(failed = false, pending = true))
        post(bubble)
    }

    private fun post(bubble: MessageView) {
        scope.launch {
            when (
                val answer =
                    clinic.api.postMessage(
                        conversationId,
                        NewChatMessageBody(clientId = bubble.clientId, body = bubble.body.orEmpty()),
                    )
            ) {
                is Outcome.Success -> {
                    replace(answer.value.toView())
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

    private suspend fun load(after: String?) {
        when (val answer = clinic.api.messages(conversationId, after = after)) {
            is Outcome.Success -> {
                val fresh =
                    answer.value.items
                        .map { it.toView() }
                        .sortedBy { it.at }
                mutableState.update { s ->
                    val known = s.messages.map { it.clientId }.toSet()
                    val merged = (
                        s.messages.map { m -> fresh.firstOrNull { it.clientId == m.clientId } ?: m } +
                            fresh.filter { it.clientId !in known }
                    )
                    s.copy(loading = false, messages = merged, error = null)
                }
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
            s.copy(
                messages =
                    s.messages.map {
                        if (it.clientId ==
                            view.clientId
                        ) {
                            view
                        } else {
                            it
                        }
                    },
            )
        }

    private fun ChatMessage.toView() =
        MessageView(id, clientId, authorMembershipId == me, authorName, body, createdAt, deleted)

    private companion object {
        const val MAX_BODY = 4000
    }
}
