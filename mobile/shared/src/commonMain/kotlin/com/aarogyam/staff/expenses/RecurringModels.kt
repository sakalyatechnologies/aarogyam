package com.aarogyam.staff.expenses

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.RecurringCadence
import com.aarogyam.staff.api.model.RecurringExpenseStatus
import kotlinx.datetime.LocalDate

/** How often a recurring expense is recorded. */
enum class RecurEvery(
    internal val wire: RecurringCadence,
) {
    Monthly(RecurringCadence.MONTHLY),
    Weekly(RecurringCadence.WEEKLY),
    ;

    internal companion object {
        fun of(wire: RecurringCadence): RecurEvery = entries.firstOrNull { it.wire == wire } ?: Monthly
    }
}

/** Where a recurring expense stands. Stopped and ended ones take no more actions. */
enum class RecurStatus(
    internal val wire: RecurringExpenseStatus,
) {
    Active(RecurringExpenseStatus.ACTIVE),
    Paused(RecurringExpenseStatus.PAUSED),
    Stopped(RecurringExpenseStatus.STOPPED),
    Ended(RecurringExpenseStatus.ENDED),
    ;

    internal companion object {
        fun of(wire: RecurringExpenseStatus): RecurStatus = entries.firstOrNull { it.wire == wire } ?: Stopped
    }
}

/** One recurring expense in the list. */
data class RecurringRow(
    val id: String,
    val category: SpendCategory,
    val categoryName: String,
    val amountPaise: Long,
    val every: RecurEvery,
    /** 1 to 31 for a monthly one; a shorter month uses its last day. */
    val dayOfMonth: Int?,
    /** 1 (Monday) to 7 (Sunday) for a weekly one. */
    val weekday: Int?,
    val nextDue: LocalDate,
    val status: RecurStatus,
    val method: PayMethod?,
    val note: String?,
    val endsOn: LocalDate?,
) {
    val canPause: Boolean get() = status == RecurStatus.Active
    val canResume: Boolean get() = status == RecurStatus.Paused
    val canStop: Boolean get() = status == RecurStatus.Active || status == RecurStatus.Paused
}

/** Why the Add recurring form cannot be saved yet. */
enum class RecurringProblem { NoAmount, TooLarge, NoDayOfMonth, NoWeekday, StartOutOfRange, NoteTooLong }

/** The Add recurring sheet (whole rupees). */
data class RecurringDraft(
    val category: SpendCategory = SpendCategory.Rent,
    val rupees: String = "",
    val method: PayMethod = PayMethod.Bank,
    val every: RecurEvery = RecurEvery.Monthly,
    /** Chosen on the sheet for a monthly one. */
    val dayOfMonth: Int? = null,
    /** Chosen on the sheet for a weekly one, 1 (Monday) to 7. */
    val weekday: Int? = null,
    val startsOn: LocalDate,
    val note: String = "",
    val saving: Boolean = false,
    val error: ScreenError? = null,
    val saved: Boolean = false,
) {
    val amountPaise: Long get() = (rupees.toLongOrNull() ?: 0) * ExpenseDraft.PAISE
}

data class RecurringExpensesState(
    val allowed: Boolean,
    val canChange: Boolean,
    val loading: Boolean = false,
    val rows: List<RecurringRow> = emptyList(),
    val error: ScreenError? = null,
    /** The row a pause, resume or stop is being sent for. */
    val busy: String? = null,
    /** The last pause, resume or stop failed; [RecurringExpensesStateHolder.clearActionError] drops it. */
    val actionError: ScreenError? = null,
    val draft: RecurringDraft,
)
