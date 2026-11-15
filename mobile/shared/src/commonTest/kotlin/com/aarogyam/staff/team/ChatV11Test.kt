package com.aarogyam.staff.team

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatV11Test {
    private val notice =
        """{"id":"9","conversation_id":"c1","author_membership_id":"m2","author_name":"Asha","client_id":"n1",
           "body":"Closed Friday","deleted":false,"is_notice":true,"created_at":"2026-10-09T04:09:00Z"}"""
    private val photo =
        """{"id":"8","conversation_id":"c1","author_membership_id":"m2","author_name":"Asha","client_id":"p1",
           "deleted":false,"created_at":"2026-10-09T04:08:00Z",
           "attachment":{"id":"f1","mime_type":"image/jpeg","size_bytes":1200,"file_name":"x.jpg"}}"""

    private fun FakeBackend.thread(
        kind: String = "group",
        pinned: Boolean = true,
        items: String = "$photo,$notice",
    ) {
        on("$SUNRISE/api/v1/conversations/c1", {
            json(
                """{"id":"c1","kind":"$kind","created_at":"x","members":[],
                   ${if (pinned) """"pinned_notice":$notice,""" else ""}"x":0}""",
            )
        })
        on("$SUNRISE/api/v1/conversations/c1/messages", { req ->
            if (req.method.value ==
                "GET"
            ) {
                json("""{"items":[$items]}""")
            } else {
                apiError(HttpStatusCode.InternalServerError, "internal")
            }
        })
        on("$SUNRISE/api/v1/conversations/c1/read", { json("{}", HttpStatusCode.NoContent) })
    }

    @Test
    fun notices_attachments_and_the_pinned_banner_are_mapped() =
        runTest {
            val backend = FakeBackend().apply { thread() }
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val s =
                graph
                    .chatThread(clinic, "c1", this)
                    .state
                    .first { !it.loading && it.pinned != null }
            val shot = s.messages.first { it.id == "8" }
            assertNull(shot.body)
            assertEquals(AttachmentView("f1", true, "x.jpg", 1200), shot.attachment)
            assertTrue(s.messages.first { it.id == "9" }.notice)
            assertEquals("Closed Friday", s.pinned?.body)
            assertTrue(s.canManageMembers)
            assertFalse(s.channel)
            assertFalse(s.canNotice)
        }

    @Test
    fun the_everyone_channel_is_first_and_cannot_be_edited() =
        runTest {
            val backend = FakeBackend().apply { thread(kind = "channel", pinned = false) }
            backend.on(
                "$SUNRISE/api/v1/conversations",
                {
                    json(
                        """{"items":[{"id":"c2","kind":"group","title":"Desk","created_at":"x","role":"member","muted":false,"unread":0},
                           {"id":"c1","kind":"channel","title":"Everyone","created_at":"x","role":"member","muted":false,"unread":1}]}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val rows =
                graph
                    .chatList(clinic, this)
                    .state
                    .first { it.rows.isNotEmpty() }
                    .rows
            assertEquals(listOf("Everyone", "Desk"), rows.map { it.title })
            assertTrue(rows.first().channel && rows.first().group)
            val s = graph.chatThread(clinic, "c1", this).state.first { !it.loading && it.channel }
            assertFalse(s.canManageMembers)
            assertNull(s.pinned)
        }

    @Test
    fun only_a_member_with_chat_notice_can_post_a_notice() =
        runTest {
            val backend = FakeBackend().apply { thread(items = "") }
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use", "chat.notice"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.state.first { !it.loading }
            backend.on("$SUNRISE/api/v1/conversations/c1/messages", { req ->
                val text = (req.body as? TextContent)?.text.orEmpty()
                if (req.method.value == "GET") {
                    json("""{"items":[]}""")
                } else {
                    json(notice.replace("n1", """client_id"""), HttpStatusCode.Created).also {
                        assertTrue(""""is_notice":true""" in text)
                    }
                }
            })
            assertTrue(thread.state.value.canNotice)
            thread.setNotice(true)
            thread.setDraft("Closed Friday")
            thread.send()
            val s = thread.state.first { it.pinned != null }
            assertFalse(s.notice, "the toggle resets after a send")
            assertEquals("9", s.pinned?.id)
        }

    @Test
    fun the_notice_toggle_is_ignored_without_permission() =
        runTest {
            val backend = FakeBackend().apply { thread(items = "") }
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.setNotice(true)
            assertFalse(thread.state.value.notice)
        }

    @Test
    fun a_photo_shows_as_sending_fails_and_is_retried_with_the_same_client_id() =
        runTest {
            val backend = FakeBackend().apply { thread(items = "") }
            backend.on(
                "$SUNRISE/api/v1/conversations/c1/attachments",
                { apiError(HttpStatusCode.InternalServerError, "internal") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.state.first { !it.loading }
            thread.setDraft("  Chart photo ")
            thread.sendPhoto(ByteArray(10) { 1 })
            assertEquals("", thread.state.value.draft)
            val failed =
                thread.state
                    .first { s -> s.messages.any { it.failed } }
                    .messages
                    .last()
            assertNotNull(failed.attachment)
            val echoed = photo.replace("\"p1\"", "\"${failed.clientId}\"")
            backend.on("$SUNRISE/api/v1/conversations/c1/attachments", { json(echoed, HttpStatusCode.Created) })
            thread.retry(failed.clientId)
            val sent =
                thread.state
                    .first { s ->
                        s.messages.size == 1 && s.messages.none { it.pending || it.failed }
                    }.messages
                    .single()
            assertEquals("f1", sent.attachment?.id)
            val bodies =
                backend.requests
                    .filter { it.url.encodedPath.endsWith("/attachments") }
                    .map { it.body.toByteArray().decodeToString() }
            assertEquals(2, bodies.size)
            val ids =
                bodies.map {
                    """client_id"?[\s\S]*?\r\n\r\n([^\r]+)"""
                        .toRegex()
                        .find(
                            it,
                        )?.groupValues
                        ?.get(1)
                }
            assertNotNull(ids.first())
            assertEquals(1, ids.distinct().size)
            assertTrue(bodies.all { "name=body" in it.replace("\"", "") && "Chart photo" in it })
            assertTrue(bodies.all { "photo.jpg" in it && "image/jpeg" in it })
        }

    @Test
    fun a_photo_over_five_megabytes_is_refused_without_a_request() =
        runTest {
            val backend = FakeBackend().apply { thread(items = "") }
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.state.first { !it.loading }
            thread.sendPhoto(ByteArray(ChatLimits.MAX_FILE_BYTES + 1))
            assertTrue(thread.state.value.refused)
            assertTrue(
                thread.state.value.messages
                    .isEmpty(),
            )
            assertTrue(backend.requests.none { it.url.encodedPath.endsWith("/attachments") })
            thread.dismissRefused()
            assertFalse(thread.state.value.refused)
        }

    @Test
    fun opening_a_file_gets_a_link_and_a_failure_is_flagged() =
        runTest {
            val backend = FakeBackend().apply { thread() }
            backend.on(
                "$SUNRISE/api/v1/chat-attachments/f1/download",
                { json("""{"url":"/files/f1?t=abc","expires_at":"x"}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.state.first { !it.loading && it.pinned != null }
            thread.openAttachment("f1")
            val link = assertNotNull(thread.state.first { it.link != null }.link)
            assertTrue(link.image)
            assertTrue(link.url.endsWith("/files/f1?t=abc"))
            thread.closeLink()
            assertNull(thread.state.value.link)
            backend.on(
                "$SUNRISE/api/v1/chat-attachments/f1/download",
                { apiError(HttpStatusCode.NotFound, "not_found") },
            )
            thread.openAttachment("f1")
            assertTrue(thread.state.first { it.linkFailed }.linkFailed)
        }

    @Test
    fun a_thumbnail_link_is_fetched_once_per_file() =
        runTest {
            val backend = FakeBackend().apply { thread() }
            backend.on(
                "$SUNRISE/api/v1/chat-attachments/f1/download",
                { json("""{"url":"/files/f1?t=abc","expires_at":"x"}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.state.first { !it.loading }
            thread.requestThumb("f1")
            thread.requestThumb("f1")
            thread.state.first { it.thumbs.containsKey("f1") }
            thread.requestThumb("f1")
            assertEquals(1, backend.requests.count { it.url.encodedPath.endsWith("/f1/download") })
        }

    @Test
    fun a_photo_without_text_sends_no_body_field() =
        runTest {
            val backend = FakeBackend().apply { thread(items = "") }
            backend.on(
                "$SUNRISE/api/v1/conversations/c1/attachments",
                { apiError(HttpStatusCode.PayloadTooLarge, "too_large") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            thread.state.first { !it.loading }
            thread.sendPhoto(ByteArray(10) { 1 })
            thread.state.first { s -> s.messages.any { it.failed } }
            val body =
                backend.requests
                    .first {
                        it.url.encodedPath.endsWith(
                            "/attachments",
                        )
                    }.body
                    .toByteArray()
                    .decodeToString()
            assertFalse("name=body" in body.replace("\"", ""))
        }
}
