package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.Badges
import com.aarogyam.staff.api.model.ChatMessage
import com.aarogyam.staff.api.model.ChatMessageList
import com.aarogyam.staff.api.model.ConversationList
import com.aarogyam.staff.api.model.ConversationStarted
import com.aarogyam.staff.api.model.InboxList
import com.aarogyam.staff.api.model.ItemList
import com.aarogyam.staff.api.model.MarkedRead
import com.aarogyam.staff.api.model.NewChatMessageBody
import com.aarogyam.staff.api.model.NewConversationBody
import com.aarogyam.staff.api.model.NotificationList
import com.aarogyam.staff.api.model.ReadUpTo
import com.aarogyam.staff.api.model.Staff
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.parameter
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/staff` (`listStaff`): members and pending invitations; needs `staff.manage`. */
suspend fun ClinicApi.staff(): Outcome<Staff, ApiError> = client.call { url("api/v1/staff") }

/** `GET /api/v1/stock/low` (`lowStock`): items at or below their reorder level, worst first. */
suspend fun ClinicApi.lowStock(): Outcome<ItemList, ApiError> = client.call { url("api/v1/stock/low") }

/** `GET /api/v1/me/badges` (`getBadges`): unread chat and notifications for the minute poll. */
suspend fun ClinicApi.badges(): Outcome<Badges, ApiError> = client.call { url("api/v1/me/badges") }

/** `GET /api/v1/conversations` (`listConversations`): the caller's conversations with unread counts. */
suspend fun ClinicApi.conversations(): Outcome<ConversationList, ApiError> = client.call { url("api/v1/conversations") }

/** `POST /api/v1/conversations` (`startConversation`): a direct one is idempotent per pair. */
suspend fun ClinicApi.startConversation(body: NewConversationBody): Outcome<ConversationStarted, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/conversations")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `GET /api/v1/conversations/{id}/messages` (`listMessages`): newer than [after] or older than [before]. */
suspend fun ClinicApi.messages(
    conversationId: String,
    after: String? = null,
    before: String? = null,
): Outcome<ChatMessageList, ApiError> =
    client.call {
        url("api/v1/conversations/${conversationId.encodeURLPathPart()}/messages")
        after?.let { parameter("after", it) }
        before?.let { parameter("before", it) }
    }

/** `POST /api/v1/conversations/{id}/messages` (`postMessage`): the client id makes a resend return the first message. */
suspend fun ClinicApi.postMessage(
    conversationId: String,
    body: NewChatMessageBody,
): Outcome<ChatMessage, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/conversations/${conversationId.encodeURLPathPart()}/messages")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

/** `POST /api/v1/conversations/{id}/read` (`markRead`): moves the read pointer forward. */
suspend fun ClinicApi.markRead(
    conversationId: String,
    messageId: String,
): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/conversations/${conversationId.encodeURLPathPart()}/read")
        contentType(ContentType.Application.Json)
        setBody(ReadUpTo(messageId = messageId))
    }

/** `GET /api/v1/notifications` (`listNotifications`): newest first. */
suspend fun ClinicApi.notifications(): Outcome<NotificationList, ApiError> = client.call { url("api/v1/notifications") }

/** `POST /api/v1/notifications/read-all` (`markAllNotificationsRead`). */
suspend fun ClinicApi.readAllNotifications(): Outcome<MarkedRead, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/notifications/read-all")
    }

/** `GET /api/v1/inbox` (`listInbox`): booking reminders and escalations. */
suspend fun ClinicApi.inbox(): Outcome<InboxList, ApiError> = client.call { url("api/v1/inbox") }
