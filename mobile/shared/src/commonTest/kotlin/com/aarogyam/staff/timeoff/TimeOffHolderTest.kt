package com.aarogyam.staff.timeoff

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val LIST = "$SUNRISE/api/v1/time-off"

private fun away(
    id: String,
    who: String,
    status: String,
    start: String = "2026-10-20",
) = """{"id":"$id","membership_id":"$who","member_name":"Name $who","kind":"vacation","reason":"Trip",
    "starts_at":"${start}T00:00:00+05:30","ends_at":"${start}T23:59:59.999+05:30","all_day":true,"status":"$status"}"""

private fun listBody(vararg items: String) = """{"items":${items.joinToString(",", "[", "]")}}"""

class TimeOffHolderTest {
    private val today = LocalDate(2026, 10, 12)

    @Test
    fun a_staff_member_sees_only_their_own_requests() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                LIST,
                {
                    json(
                        listBody(
                            away("a", "m1", "pending", "2026-10-21"),
                            away("b", "m2", "approved"),
                            away("c", "m1", "approved", "2026-10-25"),
                        ),
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("time_off.request"))
            val state = createTimeOff(clinic, backgroundScope) { today }.state.first { !it.loading }
            assertEquals(listOf("c", "a"), state.mine.map { it.id })
            assertTrue(state.pending.isEmpty())
            assertFalse(state.canManage)
            assertNull(state.mine.first().memberName)
            assertEquals(TimeOffStatus.Approved, state.mine.first().status)
            assertEquals(TimeOffKind.Vacation, state.mine.first().kind)
            assertEquals("2026-10-25", state.mine.first().firstDay)
            assertEquals("2026-10-25", state.mine.first().lastDay)
            val query =
                backend.requests
                    .first { it.url.encodedPath.endsWith("/time-off") }
                    .url.parameters
            assertEquals("2026-10-12", query["from"])
            assertEquals("2026-11-22", query["to"])
        }

    @Test
    fun a_manager_sees_the_pending_requests_of_others() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                LIST,
                {
                    json(
                        listBody(
                            away("a", "m2", "pending", "2026-10-22"),
                            away("b", "m3", "pending", "2026-10-20"),
                            away("c", "m3", "approved"),
                            away("d", "m1", "pending"),
                        ),
                    )
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("time_off.manage"))
            val state = createTimeOff(clinic, backgroundScope) { today }.state.first { !it.loading }
            assertTrue(state.canManage)
            assertEquals(listOf("b", "a"), state.pending.map { it.id })
            assertEquals("Name m3", state.pending.first().memberName)
            assertEquals(listOf("d"), state.mine.map { it.id })
        }

    @Test
    fun a_request_posts_whole_days_for_me_and_reads_the_list_again() =
        runTest {
            val backend = FakeBackend()
            backend.on(LIST, { json(listBody()) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("time_off.request"))
            val holder = createTimeOff(clinic, backgroundScope) { today }
            holder.state.first { !it.loading }
            backend.on(
                LIST,
                {
                    if (it.method ==
                        HttpMethod.Post
                    ) {
                        json(away("n", "m1", "pending"))
                    } else {
                        json(listBody(away("n", "m1", "pending")))
                    }
                },
            )
            holder.request(TimeOffKind.Sick, "2026-10-20", "2026-10-21", "  Flu  ")
            val state = holder.state.first { it.sent == 1 && it.mine.isNotEmpty() }
            assertEquals("n", state.mine.single().id)
            val post = backend.requests.last { it.method.value == "POST" }
            val sent =
                Json
                    .parseToJsonElement(
                        (post.body as OutgoingContent.ByteArrayContent).bytes().decodeToString(),
                    ).jsonObject
            assertEquals("sick", sent.getValue("kind").jsonPrimitive.content)
            assertEquals("2026-10-20", sent.getValue("first_day").jsonPrimitive.content)
            assertEquals("2026-10-21", sent.getValue("last_day").jsonPrimitive.content)
            assertEquals("Flu", sent.getValue("reason").jsonPrimitive.content)
            assertFalse(sent.containsKey("membership_id"))
        }

    @Test
    fun approve_and_cancel_call_their_routes() =
        runTest {
            val backend = FakeBackend()
            backend.on(LIST, { json(listBody(away("a", "m2", "pending"), away("b", "m1", "approved"))) })
            backend.on("$LIST/a/approve", { json(away("a", "m2", "approved")) })
            backend.on("$LIST/b/cancel", { json(away("b", "m1", "cancelled")) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("time_off.manage"))
            val holder = createTimeOff(clinic, backgroundScope) { today }
            holder.state.first { !it.loading }
            holder.approve("a", " ok ")
            holder.cancel("b")
            holder.state.first { backend.count("$LIST/a/approve") == 1 && backend.count("$LIST/b/cancel") == 1 }
            val approve = backend.requests.first { it.url.encodedPath.endsWith("/a/approve") }
            val body =
                Json
                    .parseToJsonElement(
                        (approve.body as OutgoingContent.ByteArrayContent).bytes().decodeToString(),
                    ).jsonObject
            assertEquals("ok", body.getValue("note").jsonPrimitive.content)
        }

    @Test
    fun a_role_without_the_permissions_asks_for_nothing() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            val holder = createTimeOff(clinic, backgroundScope) { today }
            holder.request(TimeOffKind.Other, "2026-10-12", "2026-10-12", null)
            assertEquals(0, backend.count(LIST))
            assertTrue(
                holder.state.value.mine
                    .isEmpty(),
            )
        }

    @Test
    fun a_failed_request_keeps_the_sheet_open_with_an_error() =
        runTest {
            val backend = FakeBackend()
            backend.on(LIST, { json(listBody()) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("time_off.request"))
            val holder = createTimeOff(clinic, backgroundScope) { today }
            holder.state.first { !it.loading }
            backend.on(LIST, { apiError(HttpStatusCode.Forbidden, "forbidden") })
            holder.request(TimeOffKind.Personal, "2026-10-12", "2026-10-12", null)
            val state = holder.state.first { it.error != null }
            assertEquals(0, state.sent)
            assertFalse(state.sending)
        }
}
