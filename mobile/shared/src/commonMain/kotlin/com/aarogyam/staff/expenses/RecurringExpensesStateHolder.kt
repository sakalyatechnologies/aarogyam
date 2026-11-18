package com.aarogyam.staff.expenses

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.createRecurringExpense
import com.aarogyam.staff.api.model.NewRecurringExpense
import com.aarogyam.staff.api.model.RecurringExpense
import com.aarogyam.staff.api.pauseRecurringExpense
import com.aarogyam.staff.api.recurringExpenses
import com.aarogyam.staff.api.resumeRecurringExpense
import com.aarogyam.staff.api.stopRecurringExpense
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.todayIn
import kotlin.time.Clock

/**
 * The clinic's recurring expenses (`GET /recurring-expenses`), the Add recurring sheet
 * (`POST /recurring-expenses`) and each one's pause, resume and stop. Listing needs
 * `finance.view`; every change needs `expenses.write`.
 */
class RecurringExpensesStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.recurring"),
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) {
    private val mutableState =
        MutableStateFlow(
            RecurringExpensesState(
                allowed = FINANCE_VIEW in clinic.permissions,
                canChange = EXPENSES_WRITE in clinic.permissions,
                draft = RecurringDraft(startsOn = today()),
            ),
        )
    val state: StateFlow<RecurringExpensesState> = mutableState.asStateFlow()

    init {
        if (mutableState.value.allowed) refresh()
    }

    fun refresh() {
        if (!mutableState.value.allowed) return
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            when (val answer = clinic.api.recurringExpenses()) {
                is Outcome.Success -> {
                    mutableState.update { it.copy(loading = false, rows = answer.value.items.map { r -> r.toRow() }) }
                }

                is Outcome.Failure -> {
                    log.warn("recurring_expenses.load_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(loading = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    fun setCategory(category: SpendCategory) = draft { it.copy(category = category) }

    fun setRupees(text: String) = draft { it.copy(rupees = text.filter(Char::isDigit).trimStart('0').take(MAX_DIGITS)) }

    fun setMethod(method: PayMethod) = draft { it.copy(method = method) }

    fun setEvery(every: RecurEvery) = draft { it.copy(every = every) }

    /** 1 to 31; the sheet offers 1 to 28 so every month has the day. */
    fun setDayOfMonth(day: Int) = draft { it.copy(dayOfMonth = day.takeIf { d -> d in 1..MAX_DAY }) }

    /** 1 (Monday) to 7 (Sunday). */
    fun setWeekday(day: Int) = draft { it.copy(weekday = day.takeIf { d -> d in 1..DAYS_IN_WEEK }) }

    fun setStartsOn(day: LocalDate) = draft { it.copy(startsOn = day) }

    fun setNote(text: String) = draft { it.copy(note = text) }

    /** Opens a fresh form, keeping the last category and method. */
    fun resetDraft() =
        mutableState.update { st ->
            st.copy(draft = RecurringDraft(category = st.draft.category, method = st.draft.method, startsOn = today()))
        }

    /** The first problem with the draft, or null when it can be saved. */
    fun problem(d: RecurringDraft = mutableState.value.draft): RecurringProblem? {
        val now = today()
        return when {
            d.amountPaise <= 0 -> RecurringProblem.NoAmount

            d.amountPaise > MAX_PAISE -> RecurringProblem.TooLarge

            d.every == RecurEvery.Monthly && d.dayOfMonth == null -> RecurringProblem.NoDayOfMonth

            d.every == RecurEvery.Weekly && d.weekday == null -> RecurringProblem.NoWeekday

            d.startsOn < now.minus(DatePeriod(days = MAX_DAYS_BACK)) ||
                d.startsOn > now.plus(DatePeriod(years = 1)) -> RecurringProblem.StartOutOfRange

            d.note.trim().length > MAX_NOTE -> RecurringProblem.NoteTooLong

            else -> null
        }
    }

    fun save() {
        val s = mutableState.value
        val d = s.draft
        if (!s.canChange || d.saving || problem(d) != null) return
        setDraft { it.copy(saving = true, saved = false, error = null) }
        scope.launch {
            val monthly = d.every == RecurEvery.Monthly
            val body =
                NewRecurringExpense(
                    category = d.category.wire,
                    amountPaise = d.amountPaise,
                    cadence = d.every.wire,
                    startsOn = d.startsOn.toString(),
                    dayOfMonth = if (monthly) d.dayOfMonth else null,
                    weekday = if (monthly) null else d.weekday,
                    method = d.method.wire,
                    note = d.note.trim().ifEmpty { null },
                )
            when (val answer = clinic.api.createRecurringExpense(body)) {
                is Outcome.Success -> {
                    val row = answer.value.toRow()
                    log.info("recurring_expense.created") { id("recurring_expense_id", row.id) }
                    mutableState.update { st ->
                        st.copy(
                            rows = listOf(row) + st.rows.filterNot { it.id == row.id },
                            draft =
                                RecurringDraft(
                                    category = d.category,
                                    method = d.method,
                                    startsOn = today(),
                                    saved = true,
                                ),
                        )
                    }
                }

                is Outcome.Failure -> {
                    log.warn("recurring_expense.create_failed") { code("error", answer.error.code.value) }
                    setDraft { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    fun pause(id: String) = step(id, "paused", { it.canPause }) { clinic.api.pauseRecurringExpense(id) }

    fun resume(id: String) = step(id, "resumed", { it.canResume }) { clinic.api.resumeRecurringExpense(id) }

    fun stop(id: String) = step(id, "stopped", { it.canStop }) { clinic.api.stopRecurringExpense(id) }

    fun clearActionError() = mutableState.update { it.copy(actionError = null) }

    private fun step(
        rowId: String,
        event: String,
        can: (RecurringRow) -> Boolean,
        send: suspend () -> Outcome<RecurringExpense, ApiError>,
    ) {
        val s = mutableState.value
        val row = s.rows.firstOrNull { it.id == rowId } ?: return
        if (!s.canChange || s.busy != null || !can(row)) return
        mutableState.update { it.copy(busy = rowId, actionError = null) }
        scope.launch {
            when (val answer = send()) {
                is Outcome.Success -> {
                    log.info("recurring_expense.$event") { id("recurring_expense_id", rowId) }
                    val changed = answer.value.toRow()
                    mutableState.update { st ->
                        st.copy(busy = null, rows = st.rows.map { if (it.id == rowId) changed else it })
                    }
                }

                is Outcome.Failure -> {
                    log.warn("recurring_expense.change_failed") {
                        id("recurring_expense_id", rowId)
                        code("error", answer.error.code.value)
                    }
                    mutableState.update { it.copy(busy = null, actionError = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** An edit by the person: clears the last result. */
    private fun draft(change: (RecurringDraft) -> RecurringDraft) =
        mutableState.update { it.copy(draft = change(it.draft).copy(saved = false, error = null)) }

    private fun setDraft(change: (RecurringDraft) -> RecurringDraft) =
        mutableState.update { it.copy(draft = change(it.draft)) }

    private fun RecurringExpense.toRow() =
        RecurringRow(
            id = id,
            category = SpendCategory.of(category),
            categoryName = categoryName,
            amountPaise = amountPaise,
            every = RecurEvery.of(cadence),
            dayOfMonth = dayOfMonth,
            weekday = weekday,
            nextDue = LocalDate.parse(nextDueOn),
            status = RecurStatus.of(status),
            method = PayMethod.of(method),
            note = note,
            endsOn = endsOn?.let(LocalDate::parse),
        )

    private companion object {
        const val FINANCE_VIEW = "finance.view"
        const val EXPENSES_WRITE = "expenses.write"
        const val MAX_PAISE = 1_00_00_000L * 100
        const val MAX_NOTE = 300
        const val MAX_DIGITS = 8
        const val MAX_DAY = 31
        const val DAYS_IN_WEEK = 7
        const val MAX_DAYS_BACK = 90
    }
}
