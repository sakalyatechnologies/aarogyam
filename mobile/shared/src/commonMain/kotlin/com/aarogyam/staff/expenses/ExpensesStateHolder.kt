package com.aarogyam.staff.expenses

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.expenses
import com.aarogyam.staff.api.model.Expense
import com.aarogyam.staff.api.model.ExpenseCategory
import com.aarogyam.staff.api.model.NewExpense
import com.aarogyam.staff.api.recordExpense
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.todayIn
import kotlin.time.Clock

/** What an expense was for, as the server names it. */
enum class SpendCategory(
    internal val wire: ExpenseCategory,
) {
    Salary(ExpenseCategory.SALARY),
    Material(ExpenseCategory.MATERIAL),
    Electricity(ExpenseCategory.ELECTRICITY),
    Lab(ExpenseCategory.LAB),
    Rent(ExpenseCategory.RENT),
    Other(ExpenseCategory.OTHER),
    ;

    internal companion object {
        fun of(wire: ExpenseCategory): SpendCategory = entries.firstOrNull { it.wire == wire } ?: Other
    }
}

/** How the expense was paid; kept on the phone only until the server stores it (BK-5). */
enum class PayMethod { Upi, Cash, Card, Bank }

/** One row of the month's list. */
data class ExpenseRow(
    val id: String,
    val category: SpendCategory,
    val categoryName: String,
    val day: LocalDate,
    val amountPaise: Long,
    val note: String?,
    val void: Boolean,
)

/** Why the add form cannot be saved yet. */
enum class ExpenseProblem { NoAmount, TooLarge, Future, NoteTooLong }

/** The Add expense sheet with its keypad entry (whole rupees). */
data class ExpenseDraft(
    val rupees: String = "",
    val category: SpendCategory = SpendCategory.Material,
    val method: PayMethod = PayMethod.Upi,
    val day: LocalDate,
    val note: String = "",
    val saving: Boolean = false,
    val error: ScreenError? = null,
    val saved: Boolean = false,
) {
    val amountPaise: Long get() = (rupees.toLongOrNull() ?: 0) * PAISE

    internal companion object {
        const val PAISE = 100L
    }
}

data class ExpensesState(
    val allowed: Boolean,
    val canAdd: Boolean,
    val loading: Boolean = false,
    val rows: List<ExpenseRow> = emptyList(),
    /** Recorded (not void) this month, in paise. */
    val totalPaise: Long = 0,
    val error: ScreenError? = null,
    val draft: ExpenseDraft,
    /** Bill photos need server support (BK-5). */
    val photoPreview: Boolean = true,
)

/**
 * The month's expenses (`GET /expenses`) and the Add expense sheet (`POST /expenses`). A failed
 * save is never retried automatically: without an idempotency key (BK-6) a retry could double it.
 */
class ExpensesStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.expenses"),
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) {
    private val mutableState =
        MutableStateFlow(
            ExpensesState(
                allowed = FINANCE_VIEW in clinic.permissions,
                canAdd = EXPENSES_WRITE in clinic.permissions,
                draft = ExpenseDraft(day = today()),
            ),
        )
    val state: StateFlow<ExpensesState> = mutableState.asStateFlow()

    init {
        if (mutableState.value.allowed) refresh()
    }

    fun refresh() {
        if (!mutableState.value.allowed) return
        mutableState.update { it.copy(loading = true, error = null) }
        scope.launch {
            val day = today()
            when (val answer = clinic.api.expenses(LocalDate(day.year, day.month, 1), day)) {
                is Outcome.Success -> {
                    val rows = answer.value.items.map { it.toRow() }
                    val total = rows.filterNot { it.void }.sumOf { it.amountPaise }
                    mutableState.update { it.copy(loading = false, rows = rows, totalPaise = total) }
                }

                is Outcome.Failure -> {
                    log.warn("expenses.load_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(loading = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    fun setRupees(text: String) = draft { it.copy(rupees = text.filter(Char::isDigit).trimStart('0').take(MAX_DIGITS)) }

    fun setCategory(category: SpendCategory) = draft { it.copy(category = category) }

    fun setMethod(method: PayMethod) = draft { it.copy(method = method) }

    fun setDay(day: LocalDate) = draft { it.copy(day = day) }

    fun setNote(text: String) = draft { it.copy(note = text) }

    /** The first problem with the draft, or null when it can be saved. */
    fun problem(d: ExpenseDraft = mutableState.value.draft): ExpenseProblem? =
        when {
            d.amountPaise <= 0 -> ExpenseProblem.NoAmount
            d.amountPaise > MAX_PAISE -> ExpenseProblem.TooLarge
            d.day > today() -> ExpenseProblem.Future
            d.note.trim().length > MAX_NOTE -> ExpenseProblem.NoteTooLong
            else -> null
        }

    fun save() {
        val s = mutableState.value
        val d = s.draft
        if (!s.canAdd || d.saving || problem(d) != null) return
        setDraft { it.copy(saving = true, saved = false, error = null) }
        scope.launch {
            val body =
                NewExpense(
                    category = d.category.wire,
                    spentOn = d.day.toString(),
                    amountPaise = d.amountPaise,
                    note = d.note.trim().ifEmpty { null },
                )
            when (val answer = clinic.api.recordExpense(body)) {
                is Outcome.Success -> {
                    log.info("expense.recorded")
                    val row = answer.value.toRow()
                    mutableState.update { st ->
                        st.copy(
                            rows = listOf(row) + st.rows,
                            totalPaise = st.totalPaise + row.amountPaise,
                            draft = ExpenseDraft(day = today(), category = d.category, method = d.method, saved = true),
                        )
                    }
                }

                is Outcome.Failure -> {
                    log.warn("expense.record_failed") { code("error", answer.error.code.value) }
                    setDraft { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** An edit by the person: clears the last result. */
    private fun draft(change: (ExpenseDraft) -> ExpenseDraft) =
        mutableState.update { it.copy(draft = change(it.draft).copy(saved = false, error = null)) }

    private fun setDraft(change: (ExpenseDraft) -> ExpenseDraft) =
        mutableState.update { it.copy(draft = change(it.draft)) }

    private fun Expense.toRow() =
        ExpenseRow(
            id,
            SpendCategory.of(category),
            categoryName,
            LocalDate.parse(spentOn),
            amountPaise,
            note,
            status == "void",
        )

    private companion object {
        const val FINANCE_VIEW = "finance.view"
        const val EXPENSES_WRITE = "expenses.write"
        const val MAX_PAISE = 1_00_00_000L * 100
        const val MAX_NOTE = 300
        const val MAX_DIGITS = 8
    }
}
