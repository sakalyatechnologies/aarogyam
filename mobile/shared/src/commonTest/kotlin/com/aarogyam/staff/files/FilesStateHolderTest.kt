package com.aarogyam.staff.files

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private fun file(
    id: String,
    label: String?,
    tooth: Int? = null,
    mime: String = "image/jpeg",
) = """{"id":"$id","kind":"photo","mime_type":"$mime","size_bytes":1000,"sha256":"${"0".repeat(64)}",
    "label":${label?.let { "\"$it\"" }},"tooth":$tooth,"created_at":"2026-10-02T20:00:00Z"}"""

private fun FakeBackend.posts() = requests.filter { it.method == HttpMethod.Post && it.url.host == SUNRISE }

/** Waits in real time (the mock engine answers on another thread) until [done] holds. */
private suspend fun until(done: () -> Boolean) =
    withContext(Dispatchers.Default) {
        withTimeout(5_000) { while (!done()) delay(10) }
    }

private fun list(vararg files: String) = """{"items":${files.joinToString(",", "[", "]")}}"""

class FilesStateHolderTest {
    private val route = "$SUNRISE/api/v1/patients/p1/attachments"

    private suspend fun TestScope.holder(
        backend: FakeBackend,
        permissions: List<String> = listOf("patients.read", "clinical.read", "clinical.write"),
    ): FilesStateHolder {
        val graph = testGraph(backend, backgroundScope)
        return graph.files(openClinic(backend, graph, this, permissions), "p1", backgroundScope)
    }

    private suspend fun FilesStateHolder.loaded() = state.first { it is FilesState.Loaded } as FilesState.Loaded

    @Test
    fun groups_files_by_label_with_presets_first_and_unlabelled_last() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                route,
                { json(list(file("a", null), file("b", "Zeta"), file("c", "Consent"), file("d", "OPG", 36))) },
            )
            val loaded = holder(backend).loaded()
            assertEquals(listOf("OPG", "Consent", "Zeta", null), loaded.groups.map { it.label })
            assertEquals(
                36,
                loaded.groups
                    .first()
                    .files
                    .single()
                    .tooth,
            )
            assertTrue(loaded.canUpload)
        }

    @Test
    fun without_clinical_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val holder = holder(backend, listOf("patients.read"))
            assertEquals(FilesState.NotAllowed, holder.state.value)
            assertEquals(0, backend.count(route))
        }

    @Test
    fun a_reader_sees_the_gallery_but_cannot_upload() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(list(file("a", "OPG"))) })
            val holder = holder(backend, listOf("patients.read", "clinical.read"))
            assertFalse(holder.loaded().canUpload)
            holder.upload(byteArrayOf(1), "OPG", null)
            advanceUntilIdle()
            assertTrue(backend.posts().isEmpty())
        }

    @Test
    fun a_colleagues_patient_is_not_found() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.NotFound, "not_found") })
            val failed = holder(backend).state.first { it is FilesState.Failed } as FilesState.Failed
            assertEquals(ScreenError.NotFound, failed.error)
        }

    @Test
    fun uploads_through_the_api_with_label_tooth_and_a_client_id_then_reloads() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { req ->
                if (req.method ==
                    HttpMethod.Post
                ) {
                    json(file("new", "Intraoral – upper", 11), HttpStatusCode.Created)
                } else {
                    json(list())
                }
            })
            val holder = holder(backend)
            holder.loaded()
            holder.upload(byteArrayOf(0x01, 0x02, 0x03), "  Intraoral – upper ", 11)
            until { backend.posts().size == 1 && backend.count(route) == 3 }
            val post = backend.posts().single()
            // The file goes to the clinic's API host, never to a storage address.
            assertEquals(SUNRISE, post.url.host)
            assertEquals("/api/v1/patients/p1/attachments", post.url.encodedPath)
            val body = post.body.toByteArray().decodeToString()
            assertTrue(body.contains("name=\"id\""))
            assertTrue(body.contains("Intraoral – upper"))
            assertTrue(body.contains("name=\"tooth\""))
            assertTrue(body.contains("photo.jpg"), body.takeLast(400))
            assertEquals(
                2,
                backend.requests.count {
                    it.url.encodedPath == "/api/v1/patients/p1/attachments" &&
                        it.method == HttpMethod.Get
                },
            )
        }

    @Test
    fun a_retry_after_a_failure_reuses_the_same_id() =
        runTest {
            val backend = FakeBackend()
            var posts = 0
            backend.on(route, { req ->
                if (req.method == HttpMethod.Post) {
                    posts += 1
                    if (posts ==
                        1
                    ) {
                        apiError(HttpStatusCode.BadRequest, "invalid_request")
                    } else {
                        json(file("new", null), HttpStatusCode.Created)
                    }
                } else {
                    json(list())
                }
            })
            val holder = holder(backend)
            holder.loaded()
            holder.upload(byteArrayOf(1), null, null)
            until { (holder.state.value as? FilesState.Loaded)?.problem == UploadProblem.Failed }
            holder.upload(byteArrayOf(1), null, null)
            until { backend.posts().size == 2 }
            val ids =
                backend
                    .posts()
                    .map {
                        Regex(
                            "name=\"id\"\\s+([0-9a-f-]{36})",
                        ).find(it.body.toByteArray().decodeToString())?.groupValues?.get(1)
                    }
            assertEquals(2, ids.size)
            assertEquals(ids[0], ids[1])
        }

    @Test
    fun a_bad_label_or_tooth_is_refused_before_sending() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(list()) })
            val holder = holder(backend)
            holder.loaded()
            holder.upload(byteArrayOf(1), "x".repeat(61), null)
            assertEquals(UploadProblem.LabelTooLong, holder.loaded().problem)
            holder.upload(byteArrayOf(1), null, 99)
            assertEquals(UploadProblem.BadTooth, holder.loaded().problem)
            advanceUntilIdle()
            assertTrue(backend.posts().isEmpty())
        }

    @Test
    fun a_preview_asks_for_a_link_and_opens_it_on_the_clinic_host() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(list(file("f1", "OPG"))) })
            backend.on("$SUNRISE/api/v1/attachments/f1/download", {
                json("""{"url":"/api/v1/attachments/f1/content?token=t","expires_at":"2026-10-02T20:05:00Z"}""")
            })
            backend.on("$SUNRISE/api/v1/attachments/f1/content", { respond(byteArrayOf(9, 8, 7)) })
            val holder = holder(backend)
            holder.loaded()
            assertEquals(listOf<Byte>(9, 8, 7), holder.preview("f1")?.toList())
            assertNull(
                backend.requests.firstOrNull {
                    it.url.host != SUNRISE && it.url.host.endsWith("supabase.co") &&
                        it.url.encodedPath.contains("storage")
                },
            )
        }
}

class PhotoRulesTest {
    @Test
    fun shrinks_the_longest_side_to_2048_and_never_enlarges() {
        assertEquals(2048 to 1536, PhotoLimits.fit(4000, 3000))
        assertEquals(1536 to 2048, PhotoLimits.fit(3000, 4000))
        assertEquals(1000 to 800, PhotoLimits.fit(1000, 800))
    }

    @Test
    fun accepts_fdi_teeth_only() {
        assertTrue(isFdiTooth(11) && isFdiTooth(48) && isFdiTooth(55) && isFdiTooth(85))
        assertFalse(isFdiTooth(49) || isFdiTooth(56) || isFdiTooth(99) || isFdiTooth(0))
    }

    @Test
    fun x_rays_and_consents_get_their_own_kind() {
        assertEquals("xray", kindFor("OPG"))
        assertEquals("consent", kindFor("Consent"))
        assertEquals("photo", kindFor("Intraoral – upper"))
        assertEquals("photo", kindFor(null))
    }
}
