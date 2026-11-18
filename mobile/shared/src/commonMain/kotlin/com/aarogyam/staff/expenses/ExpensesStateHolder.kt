package com.aarogyam.staff.expenses

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.expenseBillLink
import com.aarogyam.staff.api.expenses
import com.aarogyam.staff.api.model.Expense
import com.aarogyam.staff.api.model.ExpenseCategory
import com.aarogyam.staff.api.model.NewExpense
import com.aarogyam.staff.api.recordExpense
import com.aarogyam.staff.api.removeExpenseBill
import com.aarogyam.staff.api.uploadExpenseBill
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.IdempotencyKey
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

/**
 * The month's expenses (`GET /expenses`) and the Add expense sheet (`POST /expenses`). A save
 * carries an `Idempotency-Key` kept until the draft changes or is saved, so tapping Save again
 * after a lost answer returns the same expense instead of recording it twice. A bill photo goes up
 * after the expense is saved (`POST /expenses/{id}/bill`); if only that fails, the expense stays
 * and the photo can be sent again.
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

    /** The key for the draft on screen; a new one once it changes or is saved. */
    private var key = IdempotencyKey.generate()

    /** The saved expense and the bill photo that did not upload. */
    private var unsentBill: Pair<String, ByteArray>? = null

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

    /** Attaches (or with null, drops) the bill photo. Not part of the saved body, so the key stays. */
    fun setBill(jpeg: ByteArray?) = setDraft { it.copy(bill = jpeg, saved = false, error = null) }

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
                    method = d.method.wire,
                    note = d.note.trim().ifEmpty { null },
                )
            when (val answer = clinic.api.recordExpense(body, key)) {
                is Outcome.Success -> {
                    log.info("expense.recorded")
                    key = IdempotencyKey.generate()
                    val row = answer.value.toRow()
                    mutableState.update { st ->
                        st.copy(
                            rows = listOf(row) + st.rows,
                            totalPaise = st.totalPaise + row.amountPaise,
                            draft = ExpenseDraft(day = today(), category = d.category, method = d.method, saved = true),
                            billFailed = false,
                        )
                    }
                    d.bill?.let { sendBill(row.id, it) }
                }

                is Outcome.Failure -> {
                    log.warn("expense.record_failed") { code("error", answer.error.code.value) }
                    setDraft { it.copy(saving = false, error = ScreenError.of(answer.error)) }
                }
            }
        }
    }

    /** Sends the bill photo that did not upload again. */
    fun retryBill() {
        val (id, jpeg) = unsentBill ?: return
        mutableState.update { it.copy(billFailed = false) }
        scope.launch { sendBill(id, jpeg) }
    }

    /** Gives up on the bill photo; the expense stays saved without it. */
    fun dropBill() {
        unsentBill = null
        mutableState.update { it.copy(billFailed = false) }
    }

    /** Fetches a five-minute link to [expenseId]'s bill for the screen to open. */
    fun openBill(expenseId: String) {
        if (mutableState.value.openingBill != null) return
        mutableState.update { it.copy(openingBill = expenseId, billLink = null, billLinkFailed = false) }
        scope.launch {
            when (val answer = clinic.api.expenseBillLink(expenseId)) {
                is Outcome.Success -> {
                    val path = answer.value.url
                    val url = if (path.startsWith("/")) clinic.api.origin + path else path
                    mutableState.update { it.copy(openingBill = null, billLink = url) }
                }

                is Outcome.Failure -> {
                    log.warn("expense.bill_link_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(openingBill = null, billLinkFailed = true) }
                }
            }
        }
    }

    /** The screen opened the link (or showed the failure); it is not kept. */
    fun closeBill() = mutableState.update { it.copy(billLink = null, billLinkFailed = false, billRemoveFailed = false) }

    /** Takes the bill photo off [expenseId]; needs `expenses.write`. */
    fun removeBill(expenseId: String) {
        if (!mutableState.value.canAdd) return
        scope.launch {
            when (val answer = clinic.api.removeExpenseBill(expenseId)) {
                is Outcome.Success -> {
                    log.info("expense.bill_removed")
                    mutableState.update { st ->
                        st.copy(rows = st.rows.map { if (it.id == expenseId) it.copy(hasBill = false) else it })
                    }
                }

                is Outcome.Failure -> {
                    log.warn("expense.bill_remove_failed") { code("error", answer.error.code.value) }
                    mutableState.update { it.copy(billRemoveFailed = true) }
                }
            }
        }
    }

    private suspend fun sendBill(
        id: String,
        jpeg: ByteArray,
    ) {
        when (val answer = clinic.api.uploadExpenseBill(id, jpeg)) {
            is Outcome.Success -> {
                unsentBill = null
                log.info("expense.bill_attached")
                mutableState.update { st ->
                    st.copy(
                        rows =
                            st.rows.map {
                                if (it.id ==
                                    id
                                ) {
                                    it.copy(hasBill = true)
                                } else {
                                    it
                                }
                            },
                    )
                }
            }

            is Outcome.Failure -> {
                log.warn("expense.bill_failed") { code("error", answer.error.code.value) }
                unsentBill = id to jpeg
                mutableState.update { it.copy(billFailed = true) }
            }
        }
    }

    /** An edit by the person: clears the last result. */
    private fun draft(change: (ExpenseDraft) -> ExpenseDraft) {
        val before = mutableState.value.draft
        mutableState.update { it.copy(draft = change(it.draft).copy(saved = false, error = null)) }
        if (mutableState.value.draft != before.copy(saved = false, error = null)) key = IdempotencyKey.generate()
    }

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
            PayMethod.of(method),
            bill != null,
        )

    private companion object {
        const val FINANCE_VIEW = "finance.view"
        const val EXPENSES_WRITE = "expenses.write"
        const val MAX_PAISE = 1_00_00_000L * 100
        const val MAX_NOTE = 300
        const val MAX_DIGITS = 8
    }
}
