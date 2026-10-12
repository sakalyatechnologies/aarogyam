package com.aarogyam.staff.team

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TeamTest {
    private fun message(
        id: String,
        author: String,
        client: String,
        body: String,
    ) = """{"id":"$id","conversation_id":"c1","author_membership_id":"$author","author_name":"X","client_id":"$client",
           "body":"$body","deleted":false,"created_at":"2026-10-09T04:0$id:00Z"}"""

    @Test
    fun the_chat_list_names_direct_chats_after_the_other_person() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/conversations",
                {
                    json(
                        """{"items":[{"id":"c1","kind":"direct","created_at":"x","role":"member","muted":false,"unread":3,
                           "with":{"membership_id":"m2","name":"Pooja"}},{"id":"c2","kind":"group","title":"Front desk","created_at":"x",
                           "role":"admin","muted":true,"unread":0}]}""",
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
            assertEquals(listOf("Pooja", "Front desk"), rows.map { it.title })
            assertEquals(listOf(3, 0), rows.map { it.unread })
            assertEquals(listOf(false, true), rows.map { it.group })
        }

    @Test
    fun a_sent_message_shows_at_once_and_a_failed_one_can_be_resent() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/conversations/c1/messages", { req ->
                if (req.method.value == "GET") {
                    json("""{"items":[${message("1", "m2", "k1", "Hi doctor")}]}""")
                } else {
                    apiError(HttpStatusCode.InternalServerError, "internal")
                }
            })
            backend.on("$SUNRISE/api/v1/conversations/c1/read", { json("{}", HttpStatusCode.NoContent) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("chat.use"))
            val thread = graph.chatThread(clinic, "c1", this)
            assertEquals(
                listOf("Hi doctor"),
                thread.state
                    .first { !it.loading }
                    .messages
                    .map { it.body },
            )
            thread.setDraft("  On my way  ")
            thread.send()
            val failed =
                thread.state
                    .first { s -> s.messages.any { it.failed } }
                    .messages
                    .last()
            assertEquals("On my way", failed.body)
            assertTrue(failed.mine)
            backend.on("$SUNRISE/api/v1/conversations/c1/messages", { req ->
                val client =
                    """"client_id":"([^"]+)""""
                        .toRegex()
                        .find(
                            (req.body as? TextContent)?.text.orEmpty(),
                        )?.groupValues
                        ?.get(1)
                        ?: "?"
                json(message("2", "m1", client, "On my way"), HttpStatusCode.Created)
            })
            thread.retry(failed.clientId)
            val sent =
                thread.state
                    .first { s ->
                        s.messages.none { it.pending || it.failed } && s.messages.size == 2
                    }.messages
                    .last()
            assertEquals("2", sent.id)
            val posts =
                backend.requests.filter {
                    it.method.value == "POST" &&
                        it.url.encodedPath.endsWith(
                            "/messages",
                        )
                }
            val ids =
                posts.map {
                    """"client_id":"([^"]+)""""
                        .toRegex()
                        .find(
                            (it.body as TextContent).text,
                        )?.groupValues
                        ?.get(1)
                }
            assertEquals(1, ids.distinct().size, "a resend reuses the client id")
        }

    @Test
    fun the_owner_sees_the_team_and_others_are_not_allowed() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/staff",
                {
                    json(
                        """{"members":[{"id":"m1","user_id":"u1","display_name":"Dr. Patil","role_key":"owner","role_name":"Owner",
                           "status":"active","branches":[]},{"id":"m2","user_id":"u2","display_name":"Pooja","role_key":"assistant",
                           "role_name":"Assistant","status":"suspended","branches":[]}],"invitations":[]}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val owner = openClinic(backend, graph, this, listOf("staff.manage"))
            val rows = (graph.team(owner, this).state.first { it is ListState.Loaded } as ListState.Loaded).items
            assertEquals(listOf(true, false), rows.map { it.me })
            assertEquals(listOf(true, false), rows.map { it.active })
        }

    @Test
    fun without_the_permission_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            assertEquals(ListState.NotAllowed, graph.team(clinic, this).state.value)
            assertEquals(ListState.NotAllowed, graph.stock(clinic, this).state.value)
            assertEquals(ListState.NotAllowed, graph.notifications(clinic, this).state.value)
            assertEquals(0, backend.count("$SUNRISE/api/v1/staff") + backend.count("$SUNRISE/api/v1/stock/low"))
        }

    @Test
    fun low_stock_marks_critical_items() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/stock/low",
                {
                    json(
                        """{"items":[{"item":{"id":"i1","name":"Composite A2","unit":"piece","reorder_level":10,"active":true},
                           "on_hand":1,"status":"critical","next_expiry":"2026-12-01"}]}""",
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("inventory.read"))
            val rows = (graph.stock(clinic, this).state.first { it is ListState.Loaded } as ListState.Loaded).items
            assertEquals(StockRow("i1", "Composite A2", "piece", 1, 10, true, "2026-12-01"), rows.single())
        }
}
