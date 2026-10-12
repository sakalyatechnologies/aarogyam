package com.aarogyam.staff.tasks

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val MINE = "$SUNRISE/api/v1/tasks/mine"
private const val BADGES = "$SUNRISE/api/v1/me/badges"

private fun occurrence(
    id: String,
    due: String,
    action: String = "none",
    status: String = "open",
    photos: Int? = null,
) = """{"id":"$id","template_id":"t$id","title":"Task $id","action":"$action","local_date":"2026-10-12","due_at":"$due",
    "status":"$status","patients_without_photos_today":${photos ?: "null"}}"""

private fun mine(vararg items: String) = """{"date":"2026-10-12","items":${items.joinToString(",", "[", "]")}}"""

private fun badges(open: Int) = """{"chat_unread":0,"notifications_unread":1,"tasks_open":$open}"""

private fun bodyOf(request: HttpRequestData): JsonObject {
    val text = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
    return Json.parseToJsonElement(text).jsonObject
}

private fun completeRoute(id: String) = "$SUNRISE/api/v1/tasks/occurrences/$id/complete"

class MyTasksHolderTest {
    private val now = kotlin.time.Instant.parse("2026-10-12T06:00:00Z")

    @Test
    fun overdue_first_then_by_due_time() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                MINE,
                {
                    json(
                        mine(
                            occurrence("late", "2026-10-12T12:00:00Z"),
                            occurrence("soon", "2026-10-12T07:00:00Z"),
                            occurrence("old2", "2026-10-12T05:00:00+05:30"),
                            occurrence("old1", "2026-10-11T10:00:00Z"),
                            occurrence("done", "2026-10-12T01:00:00Z", status = "done"),
                        ),
                    )
                },
            )
            backend.on(BADGES, { json(badges(4)) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            val holder = createMyTasks(clinic, backgroundScope) { now }
            val state = holder.state.first { !it.loading }
            assertEquals(listOf("old1", "old2", "soon", "late"), state.rows.map { it.id })
            assertEquals(listOf(true, true, false, false), state.rows.map { it.overdue })
            assertEquals(1, state.doneCount)
            assertFalse(holder.proofSupported)
        }

    @Test
    fun the_open_count_comes_from_the_badge_and_falls_back_to_the_rows() =
        runTest {
            val backend = FakeBackend()
            backend.on(MINE, { json(mine(occurrence("a", "2026-10-12T07:00:00Z"))) })
            backend.on(BADGES, { json(badges(7)) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            assertEquals(7, createMyTasks(clinic, backgroundScope) { now }.state.first { !it.loading }.openCount)
            backend.on(BADGES, { apiError(HttpStatusCode.Forbidden, "forbidden") })
            assertEquals(1, createMyTasks(clinic, backgroundScope) { now }.state.first { !it.loading }.openCount)
        }

    @Test
    fun without_tasks_use_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("appointments.read"))
            val holder = createMyTasks(clinic, backgroundScope) { now }
            holder.refresh()
            assertTrue(holder.state.value.notAllowed)
            assertEquals(0, backend.count(MINE))
        }

    @Test
    fun a_confirm_photos_task_exposes_the_missing_photo_count() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                MINE,
                { json(mine(occurrence("p", "2026-10-12T15:00:00Z", action = "confirm_photos", photos = 3))) },
            )
            backend.on(BADGES, { json(badges(1)) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            val row =
                createMyTasks(clinic, backgroundScope) { now }
                    .state
                    .first { !it.loading }
                    .rows
                    .single()
            assertEquals(TaskAction.ConfirmPhotos, row.action)
            assertEquals(3, row.patientsWithoutPhotos)
        }

    @Test
    fun complete_success_removes_the_row_then_celebrates() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                MINE,
                { json(mine(occurrence("a", "2026-10-12T07:00:00Z"), occurrence("b", "2026-10-12T08:00:00Z"))) },
                { json(mine(occurrence("b", "2026-10-12T08:00:00Z"))) },
            )
            backend.on(BADGES, { json(badges(2)) }, { json(badges(1)) })
            backend.on(completeRoute("a"), { json(occurrence("a", "2026-10-12T07:00:00Z", status = "done")) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            val holder = createMyTasks(clinic, backgroundScope) { now }
            holder.state.first { it.rows.size == 2 }
            val celebration = async { holder.celebrate.first() }
            testScheduler.runCurrent()
            holder.complete("a", "  all done  ", null)
            celebration.await()
            val after = holder.state.first { it.rows.map { r -> r.id } == listOf("b") }
            assertEquals(1, after.openCount)
            val body = bodyOf(backend.requests.toList().last { it.url.encodedPath.endsWith("/complete") })
            assertEquals("all done", body["note"]?.jsonPrimitive?.content)
            assertTrue(body["client_id"]?.jsonPrimitive?.content?.isNotEmpty() == true)
        }

    @Test
    fun a_failure_keeps_the_row_shows_the_error_and_the_retry_reuses_the_client_id() =
        runTest {
            val backend = FakeBackend()
            backend.on(MINE, { json(mine(occurrence("a", "2026-10-12T07:00:00Z"))) }, { json(mine()) })
            backend.on(BADGES, { json(badges(1)) })
            backend.on(
                completeRoute("a"),
                { apiError(HttpStatusCode.InternalServerError, "internal") },
                { json(occurrence("a", "2026-10-12T07:00:00Z", status = "done")) },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            val holder = createMyTasks(clinic, backgroundScope) { now }
            holder.state.first { it.rows.size == 1 }
            val celebration = async { holder.celebrate.first() }
            testScheduler.runCurrent()
            holder.complete("a", null, null)
            val failed = holder.state.first { it.rows.singleOrNull()?.error != null }
            assertEquals(ScreenError.Server, failed.rows.single().error)
            assertFalse(failed.rows.single().pending)
            assertFalse(celebration.isCompleted)
            holder.complete("a", null, null)
            celebration.await()
            holder.state.first { it.rows.isEmpty() }
            val ids =
                backend.requests
                    .toList()
                    .filter { it.url.encodedPath.endsWith("/complete") }
                    .map { bodyOf(it)["client_id"]?.jsonPrimitive?.content }
            assertEquals(2, ids.size)
            assertEquals(ids[0], ids[1])
            assertNotEquals(null, ids[0])
        }

    @Test
    fun record_usage_sends_the_items_or_an_empty_list_for_nothing_used() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                MINE,
                {
                    json(
                        mine(
                            occurrence("u1", "2026-10-12T07:00:00Z", action = "record_usage"),
                            occurrence("u2", "2026-10-12T08:00:00Z", action = "record_usage"),
                        ),
                    )
                },
                { json(mine(occurrence("u2", "2026-10-12T08:00:00Z", action = "record_usage"))) },
                { json(mine()) },
            )
            backend.on(BADGES, { json(badges(2)) })
            backend.on(completeRoute("u1"), { json(occurrence("u1", "2026-10-12T07:00:00Z", status = "done")) })
            backend.on(completeRoute("u2"), { json(occurrence("u2", "2026-10-12T08:00:00Z", status = "done")) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("tasks.use"))
            val holder = createMyTasks(clinic, backgroundScope) { now }
            assertEquals(
                TaskAction.RecordUsage,
                holder.state
                    .first { it.rows.size == 2 }
                    .rows
                    .first()
                    .action,
            )
            holder.complete("u1", null, listOf(UsageLine("item-1", 3), UsageLine("item-2", 1)))
            holder.state.first { it.rows.none { r -> r.id == "u1" } }
            holder.complete("u2", null, emptyList())
            holder.state.first { it.rows.isEmpty() }

            fun usage(id: String) =
                bodyOf(
                    backend.requests.toList().first { it.url.encodedPath == "/api/v1/tasks/occurrences/$id/complete" },
                )["usage"]
            val first = usage("u1")!!.jsonArray
            assertEquals(2, first.size)
            assertEquals("item-1", first[0].jsonObject["item_id"]?.jsonPrimitive?.content)
            assertEquals("3", first[0].jsonObject["quantity"]?.jsonPrimitive?.content)
            assertEquals(JsonArray(emptyList()), usage("u2"))
            assertNull(bodyOf(backend.requests.toList().first { it.url.encodedPath.endsWith("/u1/complete") })["note"])
        }
}
