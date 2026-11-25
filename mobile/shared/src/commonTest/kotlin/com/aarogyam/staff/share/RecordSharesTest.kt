package com.aarogyam.staff.share

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.client.engine.mock.toByteArray
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs

class RecordSharesTest {
    private val url = "$SUNRISE/api/v1/patients/p1/record-shares"

    private suspend fun TestScope.clinic(
        backend: FakeBackend,
        permissions: List<String>,
    ) = openClinic(backend, testGraph(backend, backgroundScope), this, permissions)

    @Test
    fun creating_posts_the_chosen_kinds_and_expiry_and_lists_the_links() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                url,
                { json("""{"items":[]}""") },
                {
                    json(
                        """{"id":"s1","token":"tok","pin":"123456","record_types":["chart"],""" +
                            """"expires_at":"2026-10-15T04:00:00Z"}""",
                        HttpStatusCode.Created,
                    )
                },
                {
                    json(
                        """{"items":[{"id":"s1","record_types":["chart"],"state":"usable",""" +
                            """"expires_at":"2026-10-15T04:00:00Z","open_count":0,"created_at":"2026-10-14T04:00:00Z"}]}""",
                    )
                },
            )
            val ctx = clinic(backend, listOf("patients.read", "clinical.read"))
            val holder = RecordSharesStateHolder(ctx, "p1", backgroundScope)
            assertEquals(listOf(RecordKind.Chart, RecordKind.Xrays), holder.state.value.kinds)
            holder.toggle(RecordKind.Xrays)
            holder.toggle(RecordKind.Bills)
            holder.setExpiry(ShareExpiry.Hour)
            holder.create()
            val ready = assertIs<SharePhase.Ready>(holder.state.first { it.phase is SharePhase.Ready }.phase)
            assertEquals("${ctx.api.origin}/shared/tok", ready.url)
            assertEquals("123456", ready.pin)
            val sent =
                backend.requests
                    .last { it.method.value == "POST" }
                    .body
                    .toByteArray()
                    .decodeToString()
            assertEquals("""{"expires_in":"1h","record_types":["chart"]}""", sent)
            val row =
                holder.state
                    .first { it.links.isNotEmpty() }
                    .links
                    .single()
            assertEquals(ShareLinkState.Usable, row.state)
            assertEquals(listOf(RecordKind.Chart), row.kinds)
        }

    @Test
    fun a_role_without_patients_read_cannot_share() =
        runTest {
            val backend = FakeBackend()
            val ctx = clinic(backend, listOf("clinical.read"))
            val holder = RecordSharesStateHolder(ctx, "p1", backgroundScope)
            assertFalse(holder.state.value.allowed)
            holder.create()
            assertEquals(0, backend.count(url))
        }
}
