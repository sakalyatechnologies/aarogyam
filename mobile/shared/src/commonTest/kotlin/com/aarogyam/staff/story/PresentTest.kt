package com.aarogyam.staff.story

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.testGraph
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PresentTest {
    private val route = "$SUNRISE/api/v1/visits/v1/mouth"
    private val mouth = """{"story_version":1,"dentition":"permanent","teeth":[{"tooth":36,"note":"line break"}]}"""

    private suspend fun TestScope.open(
        backend: FakeBackend,
        permissions: List<String> = listOf("clinical.read"),
    ): PresentStateHolder {
        val graph = testGraph(backend, backgroundScope)
        val clinic = openClinic(backend, graph, this, permissions)
        return graph.present(clinic, "v1", backgroundScope)
    }

    @Test
    fun the_snapshot_goes_to_the_page_untouched_once_it_is_ready_and_again_for_dark() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(mouth) })
            val present = open(backend)
            present.onPageMessage("""{"type":"ready","bundle_version":1}""")
            val script = present.scripts.first()
            assertEquals(PresentState.Showing, present.state.value)
            assertTrue(script.startsWith("window.aarogyam.present({"), script)
            assertTrue(
                script.endsWith(
                    """, {"dark":false,"can_write":false,"can_see_prices":false,"betas":["smile3d","face"]})""",
                ),
                script,
            )
            assertTrue("\\u2028" in script && " " !in script, "a line separator is escaped for the script")
            val sent =
                script
                    .removePrefix(
                        "window.aarogyam.present(",
                    ).substringBefore(", {\"dark\"")
                    .replace("\\u2028", " ")
            assertEquals(Json.parseToJsonElement(mouth).jsonObject, Json.parseToJsonElement(sent).jsonObject)
            present.setDark(true)
            assertTrue(
                present.scripts.first().endsWith(
                    """, {"dark":true,"can_write":false,"can_see_prices":false,"betas":["smile3d","face"]})""",
                ),
            )
        }

    @Test
    fun a_bundle_this_build_does_not_know_is_not_driven() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(mouth) })
            val present = open(backend)
            present.onPageMessage("""{"type":"ready","bundle_version":99}""")
            assertEquals(PresentState.Unsupported, present.state.value)
        }

    @Test
    fun a_refused_snapshot_says_why_and_needs_clinical_read() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { apiError(HttpStatusCode.NotFound, "not_found") })
            val present = open(backend)
            assertEquals(PresentState.Failed(ScreenError.NotFound), present.state.first { it is PresentState.Failed })
            val none = open(FakeBackend(), permissions = listOf("patients.read"))
            assertEquals(PresentState.Failed(ScreenError.NotAllowed), none.state.value)
        }

    @Test
    fun exit_and_add_depth_reach_the_screen() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(mouth) })
            val present = open(backend)
            present.onPageMessage("""{"type":"add_depth","tooth":36}""")
            present.onPageMessage("""{"type":"exit"}""")
            assertEquals(PresentEvent.AddDepth(36), present.events.first())
            assertEquals(PresentEvent.Exit, present.events.first())
        }

    @Test
    fun page_messages_are_read_strictly_and_junk_is_ignored() {
        val chunk = assertIs<PageMessage.Chunk>(StoryBridge.parse("""{"type":"chunk","seq":2,"base64":"AAEC"}"""))
        assertEquals(2, chunk.seq)
        assertEquals(listOf<Byte>(0, 1, 2), chunk.bytes.toList())
        assertEquals(PageMessage.Progress(1.0), StoryBridge.parse("""{"type":"progress","value":1.4}"""))
        assertEquals(PageMessage.Done(2_100_000), StoryBridge.parse("""{"type":"done","bytes":2100000}"""))
        assertEquals(PageMessage.Failed("no_encoder"), StoryBridge.parse("""{"type":"failed","reason":"no_encoder"}"""))
        assertNull(StoryBridge.parse("""{"type":"chunk","seq":1,"base64":"%%"}"""))
        assertNull(StoryBridge.parse("""{"type":"ready"}"""))
        assertNull(StoryBridge.parse("""{"type":"later"}"""))
        assertNull(StoryBridge.parse("not json"))
        assertTrue(StoryBridge.wentBack("true"))
        assertFalse(StoryBridge.wentBack("false"))
        assertFalse(StoryBridge.wentBack(null))
    }

    @Test
    fun the_saved_look_and_the_plan_go_with_the_mouth_and_make_default_saves_the_look() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(mouth) })
            backend.on("$SUNRISE/api/v1/visits/v1/present", { json("""{"prices":[{"code":"rct","paise":450000}]}""") })
            backend.on("$SUNRISE/api/v1/me/ui-prefs", { json("""{"present_style":"xray","history_view":null}""") })
            val present = open(backend)
            present.onPageMessage("""{"type":"ready","bundle_version":1}""")
            val script = present.scripts.first()
            assertTrue(script.contains(""""style":"xray""""), script)
            assertTrue(script.contains(""""present":{"prices":[{"code":"rct","paise":450000}]}"""), script)
            present.onPageMessage("""{"type":"make_default","style":"painted"}""")
            com.aarogyam.staff.desk.until {
                backend.requests.any {
                    it.url.encodedPath == "/api/v1/me/ui-prefs" &&
                        it.method.value == "PUT"
                }
            }
            assertNull(StoryBridge.parse("""{"type":"make_default","style":"hologram"}"""), "unknown looks are ignored")
        }

    @Test
    fun the_saved_tooth_colour_opens_the_page_and_save_colour_needs_clinical_write() =
        runTest {
            val backend = FakeBackend()
            backend.on(route, { json(mouth) })
            backend.on(
                "$SUNRISE/api/v1/visits/v1",
                {
                    json(
                        """{"visit":{"id":"v1","number":"V-1","patient_id":"p1","status":"open",""" +
                            """"started_at":"2026-11-23T04:30:00Z","clinician":{"id":"m1","name":"Dr. A"}},""" +
                            """"notes":[],"procedures":[],"chart_entries":[],"attachments":[],"observations":[]}""",
                    )
                },
            )
            backend.on("$SUNRISE/api/v1/patients/p1/smile-shade", { json("""{"shade":70}""") })
            val present = open(backend, permissions = listOf("clinical.read", "clinical.write"))
            present.onPageMessage("""{"type":"ready","bundle_version":1}""")
            val script = present.scripts.first()
            assertTrue(script.contains(""""shade":70,"can_save_shade":true"""), script)
            present.onPageMessage("""{"type":"save_shade","shade":40}""")
            com.aarogyam.staff.desk.until {
                backend.requests.any {
                    it.url.encodedPath == "/api/v1/patients/p1/smile-shade" && it.method.value == "PUT"
                }
            }
            assertNull(StoryBridge.parse("""{"type":"save_shade","shade":140}"""), "out of range is ignored")

            val reader = open(backend)
            reader.onPageMessage("""{"type":"ready","bundle_version":1}""")
            val read = reader.scripts.first()
            assertTrue(read.contains(""""shade":70""") && "can_save_shade" !in read, read)
        }

    private val visitJson =
        """{"visit":{"id":"v1","number":"V-1","patient_id":"p1","status":"open",""" +
            """"started_at":"2026-11-23T04:30:00Z",""" +
            """"clinician":{"id":"m1","name":"Dr. A"}},"notes":[],"procedures":[],"chart_entries":[],""" +
            """"attachments":[],"observations":[]}"""

    private fun bridgeBackend(): FakeBackend {
        val backend = FakeBackend()
        backend.on(route, { json(mouth) })
        backend.on("$SUNRISE/api/v1/visits/v1", { json(visitJson) })
        backend.on(
            "$SUNRISE/api/v1/patients/p1/attachments",
            {
                json(
                    """{"items":[""" +
                        """{"id":"a-old","kind":"xray","mime_type":"image/jpeg",""" +
                        """"created_at":"2026-11-01T00:00:00Z"},""" +
                        """{"id":"a-doc","kind":"report","mime_type":"application/pdf",""" +
                        """"created_at":"2026-11-22T00:00:00Z"},""" +
                        """{"id":"a-here","kind":"xray","mime_type":"image/png","visit_id":"v1",""" +
                        """"created_at":"2026-10-01T00:00:00Z"}]}""",
                )
            },
        )
        backend.on("$SUNRISE/api/v1/attachments/a-here/pins", { json("""{"pins":[{"tooth":36,"x":0.5,"y":0.25}]}""") })
        backend.on("$SUNRISE/api/v1/attachments/a-old/pins", { json("""{"pins":[]}""") })
        backend.on(
            "$SUNRISE/api/v1/attachments/a-here/download",
            { json("""{"url":"/api/v1/attachments/a-here/content?t=s1","expires_at":"x"}""") },
        )
        backend.on(
            "$SUNRISE/api/v1/attachments/a-old/download",
            { json("""{"url":"/api/v1/attachments/a-old/content?t=s2","expires_at":"x"}""") },
        )
        backend.on("$SUNRISE/api/v1/patients/p1/dental-chart", { json("""{"teeth":[]}""") })
        backend.on("$SUNRISE/api/v1/visits/v1/present-discussions", { json("""{"discussions":[{"tooth":36}]}""") })
        return backend
    }

    @Test
    fun the_xrays_chart_and_discussions_reach_the_page_and_a_reader_cannot_write() =
        runTest {
            val backend = bridgeBackend()
            val present = open(backend, permissions = listOf("clinical.read", "clinical.write", "billing.read"))
            present.onPageMessage("""{"type":"ready","bundle_version":1}""")
            val script = present.scripts.first()
            assertTrue(
                script.indexOf(""""id":"a-here"""") in 0 until script.indexOf(""""id":"a-old""""),
                "this visit's X-ray first",
            )
            assertTrue(""""pins":[{"tooth":36,"x":0.5,"y":0.25}]""" in script, script)
            assertTrue("a-doc" !in script, "only X-rays go")
            assertTrue(""""chart":{"teeth":[]}""" in script, script)
            assertTrue(""""discussions":{"discussions":[{"tooth":36}]}""" in script, script)
            assertTrue("can_write" !in script && "can_see_prices" !in script, script)

            val reader = open(backend)
            reader.onPageMessage("""{"type":"ready","bundle_version":1}""")
            val read = reader.scripts.first()
            assertTrue(""""can_write":false""" in read && """"can_see_prices":false""" in read, read)
            reader.onPageMessage("""{"type":"save_pins","attachment_id":"a-here","pins":[]}""")
            reader.onPageMessage(
                """{"type":"save_discussion","tooth":36,"situation":"decay","options":[],"send_to_patient":false}""",
            )
            kotlinx.coroutines.delay(1_500)
            val writes = backend.requests.filter { it.method.value in setOf("PUT", "POST") }
            assertTrue(writes.none { "pins" in it.url.encodedPath || "discussions" in it.url.encodedPath })
        }

    @Test
    fun save_pins_is_coalesced_and_save_discussion_posts_and_a_409_says_the_visit_is_closed() =
        runTest {
            val backend = bridgeBackend()
            backend.on("$SUNRISE/api/v1/visits/v1/present-discussions", {
                if (it.method.value == "POST") {
                    apiError(HttpStatusCode.Conflict, "conflict")
                } else {
                    json("""{"discussions":[]}""")
                }
            })
            val present = open(backend, permissions = listOf("clinical.read", "clinical.write"))
            present.onPageMessage("""{"type":"ready","bundle_version":1}""")
            present.scripts.first()
            present.onPageMessage(
                """{"type":"save_pins","attachment_id":"a-here","pins":[{"tooth":11,"x":0.1,"y":0.2}]}""",
            )
            present.onPageMessage(
                """{"type":"save_pins","attachment_id":"a-here","pins":[{"tooth":12,"x":0.3,"y":0.4}]}""",
            )
            present.onPageMessage(
                """{"type":"save_discussion","tooth":36,"situation":"decay",""" +
                    """"options":[{"key":"filling","preferred":true}],"send_to_patient":true}""",
            )
            assertEquals(PresentEvent.VisitClosed, present.events.first())
            kotlinx.coroutines.delay(1_500)
            com.aarogyam.staff.desk
                .until { backend.requests.any { it.method.value == "PUT" } }
            val puts = backend.requests.filter { it.method.value == "PUT" && it.url.encodedPath.endsWith("/pins") }
            assertEquals(1, puts.size, "two edits, one PUT")
            val post = backend.requests.single { it.method.value == "POST" && "discussions" in it.url.encodedPath }
            assertEquals("/api/v1/visits/v1/present-discussions", post.url.encodedPath)

            assertNull(
                StoryBridge.parse("""{"type":"save_pins","attachment_id":"a","pins":[{"tooth":11,"x":3,"y":0.2}]}"""),
            )
            assertNull(StoryBridge.parse("""{"type":"save_pins","pins":[]}"""))
            assertNull(StoryBridge.parse("""{"type":"save_discussion","tooth":36,"options":[]}"""))
        }

    @Test
    fun show_patient_opens_the_open_visit_else_the_newest() {
        val at =
            com.aarogyam.staff.patients.ClinicMoment(
                kotlinx.datetime.LocalDate(2026, 11, 20),
                kotlinx.datetime.LocalTime(10, 0),
            )

        fun visit(
            id: String,
            open: Boolean,
        ) = com.aarogyam.staff.patients
            .VisitView(id, "V-$id", at, "Dr A", null, open)
        assertEquals("b", showPatientVisit(listOf(visit("a", false), visit("b", true))))
        assertEquals("a", showPatientVisit(listOf(visit("a", false), visit("b", false))))
        assertNull(showPatientVisit(emptyList()))
        assertNull(showPatientVisit(null))
    }
}
