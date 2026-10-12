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
    fun a_failed_save_keeps_the_draft_and_is_not_retried() =
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
