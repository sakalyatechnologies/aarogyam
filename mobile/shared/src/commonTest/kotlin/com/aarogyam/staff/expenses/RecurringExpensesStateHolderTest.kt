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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class RecurringExpensesStateHolderTest {
    private val today = LocalDate(2026, 11, 18)

    private fun recurring(
        id: String,
        status: String = "active",
        cadence: String = "monthly",
    ): String {
        val dayField = if (cadence == "monthly") """"day_of_month":5""" else """"weekday":1"""
        return """{"id":"$id","category":"rent","category_name":"Rent","amount_paise":2500000,"cadence":"$cadence",
           $dayField,"starts_on":"2026-11-01","next_due_on":"2026-12-05","status":"$status","method":"bank",
           "recorded_by":"m1","created_at":"2026-11-01T04:00:00Z","note":null,"ends_on":null}"""
    }

    @Test
    fun the_list_maps_cadence_status_and_actions() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/recurring-expenses", {
                json(
                    """{"items":[${recurring("r1")},${recurring("r2", "paused", "weekly")},
                       ${recurring("r3", "stopped")},${recurring("r4", "ended")}]}""",
                )
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            val s = holder.state.first { it.rows.isNotEmpty() }
            val r1 = s.rows[0]
            assertEquals(SpendCategory.Rent, r1.category)
            assertEquals(2500000, r1.amountPaise)
            assertEquals(RecurEvery.Monthly, r1.every)
            assertEquals(5, r1.dayOfMonth)
            assertEquals(LocalDate(2026, 12, 5), r1.nextDue)
            assertEquals(PayMethod.Bank, r1.method)
            assertEquals(RecurEvery.Weekly, s.rows[1].every)
            assertEquals(1, s.rows[1].weekday)
            assertEquals(
                listOf(RecurStatus.Active, RecurStatus.Paused, RecurStatus.Stopped, RecurStatus.Ended),
                s.rows.map { it.status },
            )
            assertEquals(listOf(true, false, false, false), s.rows.map { it.canPause })
            assertEquals(listOf(false, true, false, false), s.rows.map { it.canResume })
            assertEquals(listOf(true, true, false, false), s.rows.map { it.canStop })
            assertTrue(s.canChange)
        }

    @Test
    fun the_draft_needs_an_amount_and_its_day() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/recurring-expenses", { json("""{"items":[]}""") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            assertEquals(RecurringProblem.NoAmount, holder.problem())
            holder.setRupees("0025000")
            assertEquals(2500000, holder.state.value.draft.amountPaise)
            assertEquals(RecurringProblem.NoDayOfMonth, holder.problem())
            holder.setDayOfMonth(40)
            assertEquals(RecurringProblem.NoDayOfMonth, holder.problem())
            holder.setDayOfMonth(5)
            assertEquals(null, holder.problem())
            holder.setEvery(RecurEvery.Weekly)
            assertEquals(RecurringProblem.NoWeekday, holder.problem())
            holder.setWeekday(3)
            assertEquals(null, holder.problem())
            holder.setStartsOn(LocalDate(2026, 1, 1))
            assertEquals(RecurringProblem.StartOutOfRange, holder.problem())
            holder.setStartsOn(today)
            holder.setNote("x".repeat(301))
            assertEquals(RecurringProblem.NoteTooLong, holder.problem())
        }

    @Test
    fun saving_posts_the_cadence_day_and_method_and_adds_the_row() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/recurring-expenses",
                { req ->
                    if (req.method.value == "POST") {
                        json(recurring("r9"), HttpStatusCode.Created)
                    } else {
                        json("""{"items":[]}""")
                    }
                },
            )
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { !it.loading }
            holder.setRupees("25000")
            holder.setDayOfMonth(5)
            holder.setWeekday(2)
            holder.setNote("  Rent  ")
            holder.save()
            val s = holder.state.first { it.draft.saved }
            assertEquals(listOf("r9"), s.rows.map { it.id })
            assertEquals("", s.draft.rupees)
            val post = backend.requests.last { it.method.value == "POST" }
            assertEquals("/api/v1/recurring-expenses", post.url.encodedPath)
            val body = (post.body as TextContent).text
            assertTrue(""""cadence":"monthly"""" in body && """"day_of_month":5""" in body, body)
            assertTrue(""""method":"bank"""" in body && """"category":"rent"""" in body, body)
            assertTrue(""""amount_paise":2500000""" in body && """"note":"Rent"""" in body, body)
            assertTrue(""""starts_on":"2026-11-18"""" in body, body)
            assertFalse("weekday" in body, body)
        }

    @Test
    fun pause_resume_and_stop_hit_their_paths_and_update_the_row() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/recurring-expenses", { json("""{"items":[${recurring("r1")}]}""") })
            backend.on("$SUNRISE/api/v1/recurring-expenses/r1/pause", { json(recurring("r1", "paused")) })
            backend.on("$SUNRISE/api/v1/recurring-expenses/r1/resume", { json(recurring("r1", "active")) })
            backend.on("$SUNRISE/api/v1/recurring-expenses/r1/stop", { json(recurring("r1", "stopped")) })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { it.rows.isNotEmpty() }
            holder.resume("r1") // active: not sent
            holder.pause("r1")
            holder.state.first { it.busy == null && it.rows[0].status == RecurStatus.Paused }
            holder.resume("r1")
            holder.state.first { it.busy == null && it.rows[0].status == RecurStatus.Active }
            holder.stop("r1")
            val s = holder.state.first { it.busy == null && it.rows[0].status == RecurStatus.Stopped }
            assertFalse(s.rows[0].canStop)
            holder.pause("r1") // stopped: not sent
            val posts =
                backend.requests
                    .filter { it.method.value == "POST" && "recurring" in it.url.encodedPath }
                    .map { it.url.encodedPath }
            assertEquals(
                listOf("pause", "resume", "stop").map { "/api/v1/recurring-expenses/r1/$it" },
                posts,
            )
        }

    @Test
    fun a_refused_change_keeps_the_row_and_says_so() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/recurring-expenses", { json("""{"items":[${recurring("r1")}]}""") })
            backend.on("$SUNRISE/api/v1/recurring-expenses/r1/pause", { apiError(HttpStatusCode.Conflict, "conflict") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view", "expenses.write"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            holder.state.first { it.rows.isNotEmpty() }
            holder.pause("r1")
            val s = holder.state.first { it.actionError != null }
            assertEquals(null, s.busy)
            assertEquals(RecurStatus.Active, s.rows[0].status)
            holder.clearActionError()
            assertEquals(null, holder.state.value.actionError)
        }

    @Test
    fun finance_view_alone_lists_but_sends_no_change() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/recurring-expenses", { json("""{"items":[${recurring("r1")}]}""") })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            val s = holder.state.first { it.rows.isNotEmpty() }
            assertTrue(s.allowed)
            assertFalse(s.canChange)
            holder.pause("r1")
            holder.stop("r1")
            holder.setRupees("100")
            holder.setDayOfMonth(1)
            holder.save()
            assertEquals(0, backend.requests.count { it.method.value == "POST" && "recurring" in it.url.encodedPath })
            assertEquals(null, holder.state.value.busy)
        }

    @Test
    fun without_finance_view_nothing_loads() =
        runTest {
            val backend = FakeBackend()
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("expenses.write"))
            val holder = RecurringExpensesStateHolder(clinic, this, today = { today })
            assertFalse(holder.state.value.allowed)
            assertEquals(0, backend.count("$SUNRISE/api/v1/recurring-expenses"))
        }

    @Test
    fun an_expense_from_a_recurring_one_is_tagged() =
        runTest {
            val backend = FakeBackend()
            val row = """"category":"rent","category_name":"Rent","spent_on":"2026-11-05","amount_paise":100,
                "status":"recorded","recorded_by":"m1","created_at":"2026-11-05T04:00:00Z""""
            backend.on("$SUNRISE/api/v1/expenses", {
                json("""{"items":[{"id":"e1",$row,"recurring_expense_id":"r1"},{"id":"e2",$row}]}""")
            })
            val graph = testGraph(backend, backgroundScope)
            val clinic = openClinic(backend, graph, this, listOf("finance.view"))
            val holder = ExpensesStateHolder(clinic, this, today = { today })
            val s = holder.state.first { it.rows.isNotEmpty() || it.error != null }
            assertEquals(null, s.error)
            assertNotNull(s.rows.firstOrNull { it.recurring })
            assertEquals(listOf(true, false), s.rows.map { it.recurring })
        }
}
