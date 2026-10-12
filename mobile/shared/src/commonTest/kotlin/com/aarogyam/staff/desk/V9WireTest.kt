package com.aarogyam.staff.desk

import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.LiveUpdates
import com.aarogyam.staff.PollingUpdates
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.billing.PayMethod
import com.aarogyam.staff.json
import com.aarogyam.staff.openClinic
import com.aarogyam.staff.team.ListState
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.visit.VisitShareState
import com.aarogyam.staff.visit.VisitShareStateHolder
import com.aarogyam.staff.walkin.LOOKUP
import com.aarogyam.staff.walkin.MATCHES_JSON
import com.aarogyam.staff.walkin.WALK_INS
import com.aarogyam.staff.walkin.WalkInState
import com.aarogyam.staff.walkin.tokenJson
import com.aarogyam.staff.walkin.walkInJson
import com.sakalya.mobile.core.Logger
import io.ktor.client.engine.mock.toByteArray
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The calls the v9 backend (BE1, BE2, BE4, BE6, BE8) made live, one test group each. */
class V9WireTest {
    private val queue = "$SUNRISE/api/v1/queue"
    private val doctor =
        listOf("appointments.read", "clinical.read", "clinical.write", "patients.read", "patients.write")

    private suspend fun HttpRequestData.text() = body.toByteArray().decodeToString()

    private suspend fun TestScope.clinic(
        backend: FakeBackend,
        permissions: List<String> = doctor,
    ) = openClinic(backend, testGraph(backend, backgroundScope), this, permissions)

    // BE2: call and the board.

    @Test
    fun send_in_posts_the_call_and_reloads_the_board() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson(status = "waiting")}]}""") })
            backend.on("$queue/t1/call", { json(tokenJson(status = "called")) })
            val board = DeskBoardStateHolder(clinic(backend), backgroundScope)
            board.state.first { it is DeskBoardState.Loaded }
            backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson(status = "called")}]}""") })
            board.sendIn("t1")
            val loaded =
                board.state.first {
                    (it as? DeskBoardState.Loaded)?.tickets?.singleOrNull()?.state == PatientState.Called
                } as DeskBoardState.Loaded
            assertEquals(1, backend.count("$queue/t1/call"))
            assertTrue(loaded.calling.isEmpty())
        }

    @Test
    fun a_refused_call_shows_the_error_and_the_server_state() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson(status = "waiting")}]}""") })
            backend.on("$queue/t1/call", { apiError(HttpStatusCode.Conflict, "wrong_state") })
            val board = DeskBoardStateHolder(clinic(backend), backgroundScope)
            board.state.first { it is DeskBoardState.Loaded }
            board.sendIn("t1")
            val loaded = board.state.first { (it as? DeskBoardState.Loaded)?.error != null } as DeskBoardState.Loaded
            assertTrue(loaded.calling.isEmpty())
        }

    @Test
    fun a_role_without_clinical_write_cannot_send_in_or_filter() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson()}]}""") })
            val board = DeskBoardStateHolder(clinic(backend, listOf("appointments.read")), backgroundScope)
            val loaded = board.state.first { it is DeskBoardState.Loaded } as DeskBoardState.Loaded
            assertFalse(loaded.canFilterMine)
            board.sendIn("t1")
            board.setMine(true)
            assertEquals(0, backend.count("$queue/t1/call"))
        }

    @Test
    fun my_patients_sends_the_practitioner_id_of_the_signed_in_doctor() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[${tokenJson()}]}""") })
            backend.on(
                "$SUNRISE/api/v1/practitioners",
                {
                    json(
                        """{"items":[{"id":"d9","display_name":"Dr. Other","calendar_color":"#000000","active":true,"membership_id":"m2"},
                           {"id":"d1","display_name":"Dr. Patil","calendar_color":"#0E7490","active":true,"membership_id":"m1"}]}""",
                    )
                },
            )
            val board = DeskBoardStateHolder(clinic(backend), backgroundScope)
            board.state.first { it is DeskBoardState.Loaded }
            board.setMine(true)
            val loaded =
                board.state.first {
                    (it as? DeskBoardState.Loaded)?.let { l -> l.mine && !l.refreshing } ==
                        true
                } as DeskBoardState.Loaded
            assertTrue(loaded.canFilterMine)
            assertEquals(
                "d1",
                backend.requests
                    .last { it.url.encodedPath.endsWith("/queue") }
                    .url.parameters["practitioner_id"],
            )
            board.setMine(false)
            board.state.first { (it as? DeskBoardState.Loaded)?.let { l -> !l.mine && !l.refreshing } == true }
            assertNull(
                backend.requests
                    .last { it.url.encodedPath.endsWith("/queue") }
                    .url.parameters["practitioner_id"],
            )
        }

    @Test
    fun called_and_ready_to_bill_tokens_are_real_states() {
        assertEquals(PatientState.Called, patientState("called"))
        assertEquals(PatientState.ReadyToBill, patientState("ready_to_bill"))
    }

    // BE1: family.

    @Test
    fun the_lookup_groups_relatives_under_the_person_they_are_linked_to() =
        runTest {
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[]}""") })
            backend.on(
                LOOKUP,
                {
                    json(
                        MATCHES_JSON.replace(
                            """"family_group":[]""",
                            """"family_group":[{"of_patient_id":"p1","id":"p5","number":"SD-1050","full_name":"Tara Shah","relation":"child"}]""",
                        ),
                    )
                },
            )
            val holder =
                DeskLookupStateHolder(
                    clinic(backend, listOf("patients.read", "appointments.read", "appointments.write", "intake.write")),
                    backgroundScope,
                    debounceMillis = 0,
                )
            holder.search("9876543210")
            val matches = assertIs<DeskLookupState.Matches>(holder.state.first { it is DeskLookupState.Matches })
            assertEquals(listOf("p1", "p5"), matches.profiles.map { it.id })
            val relative = matches.profiles[1]
            assertEquals("child", relative.relation)
            assertEquals("p1", relative.familyOf)
            assertEquals("Tara Shah", relative.name)
            assertNull(matches.profiles[0].relation)
            assertTrue(DeskAction.AddFamilyMember("+919876543210", "p1") in matches.actions)
        }

    @Test
    fun a_walk_in_for_a_relative_sends_family_of() =
        runTest {
            val backend = FakeBackend()
            backend.on(WALK_INS, { json(walkInJson(), HttpStatusCode.Created) })
            backend.on(LOOKUP, { json("""{"items":[],"family_group":[]}""") })
            val holder =
                com.aarogyam.staff.walkin.WalkInStateHolder(
                    clinic(backend, listOf("patients.read", "patients.write", "appointments.write", "intake.write")),
                    backgroundScope,
                )
            holder.someoneNew()
            holder.setName("Tara Shah")
            holder.setFamilyOf("p1", "child")
            holder.submit()
            holder.state.first { it is WalkInState.Done }
            val sent = backend.requests.last { it.url.encodedPath.endsWith("walk-ins") }.text()
            assertTrue(""""family_of":{"patient_id":"p1","relation":"child"}""" in sent, sent)
        }

    @Test
    fun the_family_section_lists_adds_and_removes_links() =
        runTest {
            val backend = FakeBackend()
            val link =
                """{"id":"l1","patient_id":"p5","number":"SD-1050","full_name":"Tara Shah",""" +
                    """"relation":"child","is_primary_contact":false}"""
            val family = "$SUNRISE/api/v1/patients/p1/family"
            backend.on(family, { json("""{"items":[$link]}""") })
            val holder = FamilyStateHolder(clinic(backend), "p1", backgroundScope)
            val loaded = holder.state.first { it is FamilyState.Loaded } as FamilyState.Loaded
            val tara = Relative("l1", "p5", "SD-1050", "Tara Shah", "child", false)
            assertEquals(tara, loaded.items.single())
            assertTrue(loaded.canEdit)
            val second = link.replace("l1", "l2").replace("p5", "p6")
            backend.on(family, { request ->
                if (request.method.value ==
                    "POST"
                ) {
                    json(second, HttpStatusCode.Created)
                } else {
                    json("""{"items":[$link,$second]}""")
                }
            })
            holder.add("p6", "child")
            val grown = holder.state.first { (it as? FamilyState.Loaded)?.items?.size == 2 } as FamilyState.Loaded
            assertEquals(2, grown.items.size)
            val post =
                backend.requests
                    .last {
                        it.method.value == "POST" &&
                            it.url.encodedPath.endsWith(
                                "/family",
                            )
                    }.text()
            assertTrue(""""related_patient_id":"p6"""" in post && """"relation":"child"""" in post, post)
            backend.on("$family/l2", { json("{}", HttpStatusCode.NoContent) })
            backend.on(family, { json("""{"items":[$link]}""") })
            holder.remove("l2")
            holder.state.first { (it as? FamilyState.Loaded)?.items?.size == 1 }
            assertEquals(
                "DELETE",
                backend.requests
                    .last { it.url.encodedPath.endsWith("/l2") }
                    .method.value,
            )
        }

    @Test
    fun a_duplicate_link_is_a_refused_change_not_a_failed_screen() =
        runTest {
            val backend = FakeBackend()
            val family = "$SUNRISE/api/v1/patients/p1/family"
            backend.on(family, { request ->
                if (request.method.value ==
                    "POST"
                ) {
                    apiError(HttpStatusCode.Conflict, "already_linked")
                } else {
                    json("""{"items":[]}""")
                }
            })
            val holder = FamilyStateHolder(clinic(backend), "p1", backgroundScope)
            holder.state.first { it is FamilyState.Loaded }
            holder.add("p5", "child")
            val shown = holder.state.first { (it as? FamilyState.Loaded)?.actionError != null } as FamilyState.Loaded
            assertTrue(shown.actionError is ScreenError)
        }

    // BE4: staff notifications.

    @Test
    fun queue_notifications_carry_the_token_and_the_clinic_number_only() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/notifications",
                {
                    json(
                        """{"items":[{"id":"n1","kind":"send_in","created_at":"2026-10-08T04:00:00Z","read":false,
                          "queue_token":{"id":"t1","token_number":7,"status":"waiting","patient_number":"SC-1042",
                          "practitioner_id":"d1","practitioner_name":"Dr. Patil"}},
                          {"id":"n2","kind":"collect_payment","created_at":"2026-10-08T04:05:00Z","read":true,
                          "queue_token":{"id":"t2","token_number":8,"status":"ready_to_bill","patient_number":"SC-1043"}}]}""",
                    )
                },
            )
            val ctx = clinic(backend, listOf("billing.write"))
            val holder =
                com.aarogyam.staff.team
                    .NotificationsStateHolder(ctx, backgroundScope)
            val list = holder.state.first { it is ListState.Loaded } as ListState.Loaded
            val first = list.items.first()
            assertEquals("send_in", first.kind)
            assertEquals(7, first.tokenNumber)
            assertEquals("SC-1042", first.patientNumber)
            assertEquals("Dr. Patil", first.doctor)
            assertEquals("", first.appointmentId)
            assertEquals("collect_payment", list.items[1].kind)
        }

    // BE6: payment proof.

    @Test
    fun the_proof_is_uploaded_as_payment_proof_and_named_by_the_payment() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/patients/p1/attachments",
                {
                    json(
                        """{"id":"a1","kind":"payment_proof","mime_type":"image/jpeg","size_bytes":3,"sha256":"x","created_at":"2026-10-08T04:00:00Z"}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            backend.on(
                "$SUNRISE/api/v1/payments",
                {
                    json(
                        """{"id":"pay1","number":"RC/26-27/000042","patient":{"id":"p1","number":"SD-1042","name":"Meera Shah"},
                          "received_at":"2026-10-08T04:00:00Z","amount_paise":50000,"method":"upi","status":"received",
                          "allocated_paise":0,"unallocated_paise":50000,"allocations":[],"attachment_id":"a1"}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            val job =
                PaymentJob(
                    "sunrise",
                    "p1",
                    PayMethod.Upi.name,
                    50000,
                    proofId = "0192f3a4-5b6c-7d8e-9f01-23456789abce",
                    proofJpegBase64 = encodeProof(byteArrayOf(1, 2, 3)),
                )
            val done =
                deliver(
                    clinic(backend, listOf("billing.write", "billing.read")).api,
                    job,
                    "0192f3a4-5b6c-7d8e-9f01-23456789abcd",
                    Logger("t"),
                )
            assertEquals(Delivery.Done("RC/26-27/000042", ProofStatus.Sent), done)
            val upload = backend.requests.first { it.url.encodedPath.endsWith("/attachments") }.text()
            assertTrue("payment_proof" in upload, "kind is payment_proof")
            val payment = backend.requests.last { it.url.encodedPath.endsWith("/payments") }.text()
            assertTrue(""""attachment_id":"a1"""" in payment, payment)
            assertTrue(
                backend.requests.indexOfFirst { it.url.encodedPath.endsWith("/attachments") } <
                    backend.requests.indexOfFirst { it.url.encodedPath.endsWith("/payments") },
            )
        }

    @Test
    fun a_proof_the_server_refuses_does_not_block_the_payment() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/patients/p1/attachments", { apiError(HttpStatusCode.Forbidden, "forbidden") })
            backend.on(
                "$SUNRISE/api/v1/payments",
                {
                    json(
                        """{"id":"pay1","number":"RC/1","patient":{"id":"p1","number":"SD-1042","name":"Meera Shah"},
                          "received_at":"2026-10-08T04:00:00Z","amount_paise":50000,"method":"cash","status":"received",
                          "allocated_paise":0,"unallocated_paise":50000,"allocations":[]}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            val job =
                PaymentJob(
                    "sunrise",
                    "p1",
                    PayMethod.Cash.name,
                    50000,
                    proofId = "0192f3a4-5b6c-7d8e-9f01-23456789abce",
                    proofJpegBase64 = encodeProof(byteArrayOf(1)),
                )
            val done =
                deliver(
                    clinic(backend, listOf("billing.write")).api,
                    job,
                    "0192f3a4-5b6c-7d8e-9f01-23456789abcd",
                    Logger("t"),
                )
            assertEquals(Delivery.Done("RC/1", ProofStatus.NotSent), done)
            assertFalse("attachment_id" in backend.requests.last { it.url.encodedPath.endsWith("/payments") }.text())
        }

    // Link an existing patient as a relative.

    @Test
    fun link_problems_cover_nobody_themselves_already_linked_and_the_relation() {
        assertEquals(listOf(LinkProblem.NoPatient, LinkProblem.BadRelation), linkProblems("p1", null, null, emptySet()))
        assertEquals(listOf(LinkProblem.Themselves), linkProblems("p1", "p1", "child", emptySet()))
        assertEquals(listOf(LinkProblem.AlreadyLinked), linkProblems("p1", "p5", "child", setOf("p5")))
        assertEquals(listOf(LinkProblem.BadRelation), linkProblems("p1", "p5", "cousin", emptySet()))
        assertTrue(linkProblems("p1", "p5", "sibling", setOf("p9")).isEmpty())
    }

    @Test
    fun the_link_search_skips_the_patient_and_relatives_then_a_link_is_posted() =
        runTest {
            val backend = FakeBackend()
            val link =
                """{"id":"l1","patient_id":"p5","number":"SD-1050","full_name":"Tara Shah","relation":"child","is_primary_contact":false}"""
            val second = link.replace("l1", "l2").replace("p5", "p7")
            var linked = false
            backend.on("$SUNRISE/api/v1/patients/p1/family", { request ->
                if (request.method.value == "POST") {
                    linked = true
                    json(second, HttpStatusCode.Created)
                } else {
                    json("""{"items":[$link${if (linked) ",$second" else ""}]}""")
                }
            })
            backend.on(
                "$SUNRISE/api/v1/patients/search",
                {
                    json(
                        com.aarogyam.staff.patientListJson(
                            com.aarogyam.staff.patientJson("p1", "Meera Shah", "SD-1042"),
                            com.aarogyam.staff.patientJson("p5", "Tara Shah", "SD-1050"),
                            com.aarogyam.staff.patientJson("p7", "Ravi Shah", "SD-1051"),
                        ),
                    )
                },
            )
            val holder = FamilyStateHolder(clinic(backend), "p1", backgroundScope)
            holder.state.first { it is FamilyState.Loaded }
            holder.searchCandidates("SD-10")
            val found = assertIs<LinkSearch.Found>(holder.search.first { it is LinkSearch.Found })
            assertEquals(listOf(LinkCandidate("p7", "SD-1051", "Ravi Shah")), found.items)
            holder.add("p7", "sibling")
            holder.state.first { (it as? FamilyState.Loaded)?.items?.size == 2 }
            val post = backend.requests.last { it.method.value == "POST" }
            assertTrue(
                """"related_patient_id":"p7"""" in post.text() && """"relation":"sibling"""" in post.text(),
                post.text(),
            )
        }

    @Test
    fun a_one_letter_search_does_nothing() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/patients/p1/family", { json("""{"items":[]}""") })
            val holder = FamilyStateHolder(clinic(backend), "p1", backgroundScope)
            holder.searchCandidates("S")
            assertEquals(LinkSearch.Idle, holder.search.value)
            assertEquals(0, backend.count("$SUNRISE/api/v1/patients/search"))
        }

    // BE8: share the visit summary.

    @Test
    fun share_visit_makes_a_link_on_the_clinic_host_and_a_pin() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/visits/v1/share",
                {
                    json(
                        """{"id":"s1","token":"tok","path":"/shared/tok","pin":"123456","expires_at":"2026-10-15T04:00:00Z"}""",
                        HttpStatusCode.Created,
                    )
                },
            )
            val ctx = clinic(backend)
            val holder = VisitShareStateHolder(ctx, "v1", backgroundScope)
            assertEquals(VisitShareState.Idle, holder.state.value)
            holder.share()
            val ready = assertIs<VisitShareState.Ready>(holder.state.first { it is VisitShareState.Ready })
            assertEquals("${ctx.api.origin}/shared/tok", ready.url)
            assertEquals("123456", ready.pin)
            assertEquals(
                "POST",
                backend.requests
                    .last()
                    .method.value,
            )
        }

    @Test
    fun sharing_needs_clinical_read() =
        runTest {
            val backend = FakeBackend()
            val holder = VisitShareStateHolder(clinic(backend, listOf("appointments.read")), "v1", backgroundScope)
            holder.share()
            assertEquals(VisitShareState.Idle, holder.state.value)
            assertEquals(0, backend.count("$SUNRISE/api/v1/visits/v1/share"))
        }

    // Live updates.

    @Test
    fun polling_updates_emit_on_their_interval_and_the_board_observes_them() =
        runTest {
            val ticks = PollingUpdates(1_000).changes().take(2).toList()
            assertEquals(2, ticks.size)
            val backend = FakeBackend()
            backend.on(queue, { json("""{"date":"2026-10-08","items":[]}""") })
            val board = DeskBoardStateHolder(clinic(backend), backgroundScope)
            board.state.first { it is DeskBoardState.Loaded }
            val before = backend.count(queue)
            board.observe(
                object : LiveUpdates {
                    override fun changes() = kotlinx.coroutines.flow.flowOf(Unit)
                },
            )
            board.state.first { backend.count(queue) > before }
            assertTrue(backend.count(queue) > before)
        }
}
