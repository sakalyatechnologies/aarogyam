package com.aarogyam.staff.team

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.conversations
import com.aarogyam.staff.clinic.ClinicContext
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
    /** The clinic-wide "Everyone" channel: shown first, its members can't be edited. */
    val channel: Boolean = false,
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
                        answer.value.items
                            .map {
                                ConversationRow(
                                    it.id,
                                    it.kind == ChatKind.GROUP || it.kind == ChatKind.CHANNEL,
                                    it.kind == ChatKind.CHANNEL,
                                    it.title ?: it.with?.name.orEmpty(),
                                    it.unread.toInt(),
                                    it.muted,
                                    it.lastMessageAt,
                                )
                            }.sortedBy { !it.channel }
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
