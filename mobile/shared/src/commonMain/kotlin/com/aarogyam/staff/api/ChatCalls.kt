package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.ChatMessage
import com.aarogyam.staff.api.model.Conversation
import com.aarogyam.staff.api.model.DownloadLink
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/conversations/{id}` (`getConversation`): kind, members and the pinned notice. */
internal suspend fun ClinicApi.conversation(id: String): Outcome<Conversation, ApiError> =
    client.call { url("api/v1/conversations/${id.encodeURLPathPart()}") }

/** `GET /api/v1/chat-attachments/{id}/download` (`getChatAttachmentDownloadLink`): a five-minute link. */
internal suspend fun ClinicApi.chatAttachmentLink(id: String): Outcome<DownloadLink, ApiError> =
    client.call { url("api/v1/chat-attachments/${id.encodeURLPathPart()}/download") }

/**
 * `POST /api/v1/conversations/{id}/attachments` (`postChatAttachment`): form fields `client_id`, `file` (JPEG,
 * PNG or PDF up to 5 MB) and an optional `body` caption (left out when empty); no other field is accepted. The same client id and file makes a retry return the first message.
 */
internal suspend fun ClinicApi.postChatAttachment(
    conversationId: String,
    clientId: String,
    jpeg: ByteArray,
    caption: String? = null,
): Outcome<ChatMessage, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/conversations/${conversationId.encodeURLPathPart()}/attachments")
        setBody(
            MultiPartFormDataContent(
                formData {
                    append("client_id", clientId)
                    if (!caption.isNullOrEmpty()) append("body", caption)
                    append(
                        "file",
                        jpeg,
                        Headers.build {
                            append(HttpHeaders.ContentType, "image/jpeg")
                            append(HttpHeaders.ContentDisposition, "filename=\"photo.jpg\"")
                        },
                    )
                },
            ),
        )
    }
