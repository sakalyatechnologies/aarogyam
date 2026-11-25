package com.aarogyam.patient

import com.aarogyam.patient.files.FileCache
import com.aarogyam.patient.files.FileKind
import com.aarogyam.patient.files.FilesStateHolder
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

private class MemoryCache : FileCache {
    val saved = mutableMapOf<String, ByteArray>()

    override fun save(
        name: String,
        bytes: ByteArray,
    ): String? {
        saved[name] = bytes
        return "/cache/$name"
    }

    override fun clear() = saved.clear()
}

class FilesStateHolderTest {
    private val filesUrl = "$DEMO_APP/api/v1/me/patient/files"

    private fun filesJson() =
        """{"items":[
        {"id":"f1","clinic_id":"$SUNRISE_ID","kind":"xray","label":"OPG","mime_type":"image/jpeg","size_bytes":12,"created_at":"2026-10-01T10:00:00+05:30"},
        {"id":"f2","clinic_id":"$SUNRISE_ID","kind":"report","mime_type":"application/pdf","size_bytes":12,"created_at":"2026-10-01T10:00:00+05:30"},
        {"id":"f3","clinic_id":"$SUNRISE_ID","kind":"document","mime_type":"application/zip","size_bytes":12,"created_at":"2026-10-01T10:00:00+05:30"}
        ]}"""

    @Test
    fun an_image_is_fetched_from_its_clinic_into_the_cache_and_a_zip_is_not_opened() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson(clinicJson()))
            backend.on(filesUrl, { json(filesJson()) })
            backend.on("$SUNRISE/api/v1/me/patient/files/f1/content", {
                respond(byteArrayOf(1, 2, 3), HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "image/jpeg"))
            })
            val cache = MemoryCache()
            val holder = graph.files(backgroundScope, cache)
            val loaded = holder.state.first { !it.loading }
            assertEquals(listOf(FileKind.Image, FileKind.Pdf, FileKind.Other), loaded.files.map { it.kind })
            assertEquals("Sunrise Dental", loaded.files[0].clinicName)

            holder.open(loaded.files[2])
            assertNull(holder.state.value.opening)

            holder.open(loaded.files[0])
            val opened = holder.state.first { it.opened != null }.opened
            assertNotNull(opened)
            assertEquals("/cache/f1.img", opened.path)
            assertEquals(listOf<Byte>(1, 2, 3), cache.saved["f1.img"]?.toList())

            holder.close()
            assertNull(holder.state.value.opened)
            assertEquals(emptyMap(), cache.saved)
        }

    @Test
    fun a_file_that_is_gone_says_not_found() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson(clinicJson()))
            backend.on(filesUrl, { json(filesJson()) })
            backend.on(
                "$SUNRISE/api/v1/me/patient/files/f2/content",
                { apiError(HttpStatusCode.NotFound, "not_found") },
            )
            val holder = graph.files(backgroundScope, MemoryCache())
            val loaded = holder.state.first { !it.loading }
            holder.open(loaded.files[1])
            assertEquals(ScreenError.NotFound, holder.state.first { it.openError != null }.openError)
        }
}
