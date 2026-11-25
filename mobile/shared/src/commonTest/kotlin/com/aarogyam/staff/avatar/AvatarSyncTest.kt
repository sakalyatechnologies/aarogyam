package com.aarogyam.staff.avatar

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.api.model.Avatar
import com.aarogyam.staff.device.MemoryPreferences
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpMethod
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val AVATAR = "$SUNRISE/api/v1/me/avatar"
private const val CONTENT = "$SUNRISE/api/v1/avatars/a1/content"
private const val SAVED = """{"preset":"d2","photo_url":null,"photo_expires_at":null}"""

class AvatarSyncTest {
    @Test
    fun a_chosen_illustration_is_put_on_the_server_as_a_form() =
        runTest {
            val backend = FakeBackend()
            backend.on(AVATAR, { json(SAVED) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            AvatarSync(MemoryPreferences()).savePreset(clinic.api, "d2")
            val put = backend.requests.single { it.url.encodedPath == "/api/v1/me/avatar" }
            assertEquals(HttpMethod.Put, put.method)
            assertTrue(
                put.body.contentType
                    .toString()
                    .startsWith("multipart/form-data"),
            )
        }

    @Test
    fun a_failed_save_does_not_throw() =
        runTest {
            val backend = FakeBackend()
            backend.on(AVATAR, { respond("", io.ktor.http.HttpStatusCode.PayloadTooLarge) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            AvatarSync(MemoryPreferences()).savePhoto(clinic.api, byteArrayOf(1, 2, 3))
            assertEquals(1, backend.count(AVATAR))
        }

    @Test
    fun a_phone_with_no_choice_takes_the_servers_illustration_or_photo() =
        runTest {
            val backend = FakeBackend()
            backend.on(CONTENT, { respond(byteArrayOf(9, 8, 7)) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))

            val preset = MemoryPreferences()
            assertTrue(AvatarSync(preset).pullIfMissing(clinic.api, Avatar(preset = "d4")) { })
            assertEquals("d4", preset.get(PreferenceKey.AvatarChoice))

            val photo = MemoryPreferences()
            var written: ByteArray? = null
            val link = Avatar(photoUrl = "/api/v1/avatars/a1/content?token=t")
            assertTrue(AvatarSync(photo).pullIfMissing(clinic.api, link) { written = it })
            assertEquals(AvatarSync.PHOTO, photo.get(PreferenceKey.AvatarChoice))
            assertEquals(listOf<Byte>(9, 8, 7), written?.toList())
        }

    @Test
    fun a_device_choice_is_never_replaced_and_nothing_is_fetched_without_a_server_avatar() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            val prefs = MemoryPreferences()
            prefs.set(PreferenceKey.AvatarChoice, "d1")
            assertFalse(AvatarSync(prefs).pullIfMissing(clinic.api, Avatar(preset = "d4")) { })
            assertEquals("d1", prefs.get(PreferenceKey.AvatarChoice))
            assertFalse(AvatarSync(MemoryPreferences()).pullIfMissing(clinic.api, null) { })
            assertNull(AvatarSync(MemoryPreferences()).photoOf(clinic.api, Avatar(preset = "d4")))
        }

    @Test
    fun another_members_photo_is_fetched_once() =
        runTest {
            val backend = FakeBackend()
            backend.on(CONTENT, { respond(byteArrayOf(5)) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("patients.read"))
            val sync = AvatarSync(MemoryPreferences())
            val first = Avatar(photoUrl = "/api/v1/avatars/a1/content?token=one")
            val again = Avatar(photoUrl = "/api/v1/avatars/a1/content?token=two")
            assertEquals(listOf<Byte>(5), sync.photoOf(clinic.api, first)?.toList())
            assertEquals(listOf<Byte>(5), sync.photoOf(clinic.api, again)?.toList())
            assertEquals(1, backend.count(CONTENT))
        }
}
