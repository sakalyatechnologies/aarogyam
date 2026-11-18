package com.aarogyam.staff.expenses

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
import kotlinx.datetime.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ExpensesStateHolderTest {
    private val today = LocalDate(2026, 10, 9)

    private fun expense(
        id: String,
        paise: Long,
        status: String = "recorded",
    ) = """{"id":"$id","category":"lab","category_name":"Lab","spent_on":"2026-10-08","amount_paise":$paise,
           "status":"$status","recorded_by":"m1","created_at":"2026-10-08T04:00:00Z","note":null}"""

    @Test
    fun the_month_lists_from_the_first_and_totals_recorded_rows() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/expenses", {
                json("""{"items":[${expense("e1", 150000)},${expense("e2", 99000, "void")}]}""")
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            val s = holder.state.first { it.rows.isNotEmpty() }
            assertEquals(150000, s.totalPaise)
            assertEquals(listOf(false, true), s.rows.map { it.void })
            val q =
                backend.requests
                    .last()
                    .url.parameters
            assertEquals("2026-10-01", q["from"])
            assertEquals("2026-10-09", q["to"])
        }

    @Test
    fun the_draft_is_checked_before_saving() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/expenses", { json("""{"items":[]}""") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            assertEquals(ExpenseProblem.NoAmount, holder.problem())
            holder.setRupees("00450")
            assertEquals("450", holder.state.value.draft.rupees)
            assertEquals(45000, holder.state.value.draft.amountPaise)
            holder.setDay(LocalDate(2026, 10, 10))
            assertEquals(ExpenseProblem.Future, holder.problem())
            holder.setDay(today)
            holder.setNote("x".repeat(301))
            assertEquals(ExpenseProblem.NoteTooLong, holder.problem())
            holder.setNote("Crown from lab")
            assertEquals(null, holder.problem())
        }

    @Test
    fun saving_posts_once_and_adds_the_row() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/expenses",
                { req ->
                    if (req.method.value ==
                        "POST"
                    ) {
                        json(expense("e9", 45000), HttpStatusCode.Created)
                    } else {
                        json("""{"items":[]}""")
                    }
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { !it.loading }
            holder.setRupees("450")
            holder.setCategory(SpendCategory.Lab)
            holder.setNote("  Crown  ")
            holder.save()
            val s = holder.state.first { it.draft.saved }
            assertEquals(listOf("e9"), s.rows.map { it.id })
            assertEquals(45000, s.totalPaise)
            assertEquals("", s.draft.rupees)
            val post = backend.requests.last { it.method.value == "POST" && it.url.encodedPath == "/api/v1/expenses" }
            val body = (post.body as TextContent).text
            assertTrue(
                """"category":"lab"""" in body && """"amount_paise":45000""" in body && """"note":"Crown"""" in body,
                body,
            )
            assertTrue(""""spent_on":"2026-10-09"""" in body, body)
        }

    @Test
    fun a_failed_save_keeps_the_draft_and_saving_again_reuses_its_key() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/expenses",
                { req ->
                    if (req.method.value ==
                        "POST"
                    ) {
                        apiError(HttpStatusCode.InternalServerError, "internal")
                    } else {
                        json("""{"items":[]}""")
                    }
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { !it.loading }
            holder.setRupees("450")
            holder.save()
            val s = holder.state.first { it.draft.error != null }
            assertEquals("450", s.draft.rupees)
            assertFalse(s.draft.saving)
            assertEquals(
                1,
                backend.requests.count {
                    it.method.value == "POST" &&
                        it.url.encodedPath == "/api/v1/expenses"
                },
            )
            // Save again: the same key, so a lost answer can't record it twice; an edit starts a new one.
            holder.save()
            holder.state.first { !it.draft.saving && it.draft.error != null }
            holder.setRupees("460")
            holder.save()
            holder.state.first { !it.draft.saving && it.draft.error != null && it.draft.rupees == "460" }
            val keys =
                backend.requests
                    .filter { it.method.value == "POST" && it.url.encodedPath == "/api/v1/expenses" }
                    .map { it.headers["Idempotency-Key"] }
            assertEquals(3, keys.size)
            assertTrue(keys.all { it != null })
            assertEquals(keys[0], keys[1])
            assertTrue(keys[2] != keys[1])
        }

    @Test
    fun the_method_is_saved_and_the_bill_goes_up_after_the_expense() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/expenses",
                { req ->
                    if (req.method.value ==
                        "POST"
                    ) {
                        json(expense("e9", 45000), HttpStatusCode.Created)
                    } else {
                        json("""{"items":[]}""")
                    }
                },
            )
            backend.on(
                "$SUNRISE/api/v1/expenses/e9/bill",
                { apiError(HttpStatusCode.ServiceUnavailable, "unavailable") },
                {
                    val bill = """"note":null,"bill":{"mime_type":"image/jpeg","size_bytes":3}"""
                    json(expense("e9", 45000).replace(""""note":null""", bill))
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { !it.loading }
            holder.setRupees("450")
            holder.setMethod(PayMethod.Cash)
            holder.setBill(byteArrayOf(1, 2, 3))
            holder.save()
            holder.state.first { it.billFailed }
            val body =
                backend.requests
                    .first { it.method.value == "POST" && it.url.encodedPath == "/api/v1/expenses" }
                    .let { (it.body as TextContent).text }
            assertTrue(""""method":"cash"""" in body, body)
            assertTrue(holder.state.value.draft.saved, "the expense itself is saved")
            assertEquals(null, holder.state.value.draft.bill, "the next draft starts without a photo")
            assertFalse(
                holder.state.value.rows
                    .single()
                    .hasBill,
            )
            holder.retryBill()
            holder.state.first { st -> st.rows.single().hasBill }
            assertFalse(holder.state.value.billFailed)
            assertEquals(2, backend.count("$SUNRISE/api/v1/expenses/e9/bill"))
            val posts = backend.requests.count { it.method.value == "POST" && it.url.encodedPath == "/api/v1/expenses" }
            assertEquals(1, posts, "the expense was not posted twice")
        }

    @Test
    fun a_bill_opens_through_a_link_on_the_clinic_host() =
        runTest {
            val backend = FakeBackend()
            val withBill =
                expense("e1", 150000).replace(
                    """"note":null""",
                    """"note":null,"method":"upi","bill":{"mime_type":"application/pdf","size_bytes":9}""",
                )
            backend.on("$SUNRISE/api/v1/expenses", { json("""{"items":[$withBill]}""") })
            backend.on(
                "$SUNRISE/api/v1/expenses/e1/bill/download",
                { json("""{"url":"/files/bill?t=signed","expires_at":"2026-10-09T04:05:00Z"}""") },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            val row =
                holder.state
                    .first { it.rows.isNotEmpty() }
                    .rows
                    .single()
            assertEquals(PayMethod.Upi, row.method)
            assertTrue(row.hasBill)
            holder.openBill("e1")
            val link = holder.state.first { it.billLink != null }.billLink
            assertEquals(clinic.api.origin + "/files/bill?t=signed", link)
            holder.closeBill()
            assertEquals(null, holder.state.value.billLink)
            holder.removeBill("e1")
            assertEquals(0, backend.count("$SUNRISE/api/v1/expenses/e1/bill"), "finance.view alone cannot remove it")
        }

    @Test
    fun removing_a_bill_clears_the_row_and_a_refusal_says_so() =
        runTest {
            val backend = FakeBackend()
            val withBill =
                expense(
                    "e1",
                    150000,
                ).replace(""""note":null""", """"note":null,"bill":{"mime_type":"image/jpeg","size_bytes":9}""")
            backend.on("$SUNRISE/api/v1/expenses", { json("""{"items":[$withBill]}""") })
            backend.on(
                "$SUNRISE/api/v1/expenses/e1/bill",
                { apiError(HttpStatusCode.Conflict, "conflict") },
                { json(expense("e1", 150000)) },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { it.rows.isNotEmpty() }
            holder.removeBill("e1")
            holder.state.first { it.billRemoveFailed }
            assertTrue(
                holder.state.value.rows
                    .single()
                    .hasBill,
            )
            holder.closeBill()
            holder.removeBill("e1")
            holder.state.first { !it.rows.single().hasBill }
            assertEquals(
                "DELETE",
                backend.requests
                    .last()
                    .method.value,
            )
        }

    @Test
    fun without_finance_view_nothing_loads_and_without_expenses_write_nothing_saves() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/expenses", { json("""{"items":[]}""") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { !it.loading }
            holder.setRupees("100")
            holder.save()
            assertFalse(holder.state.value.canAdd)
            assertEquals(
                0,
                backend.requests.count {
                    it.method.value == "POST" &&
                        it.url.encodedPath == "/api/v1/expenses"
                },
            )
        }
}
