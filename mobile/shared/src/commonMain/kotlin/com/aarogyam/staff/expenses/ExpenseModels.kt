package com.aarogyam.staff.expenses

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.model.ExpenseCategory
import kotlinx.datetime.LocalDate

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

/** How the expense was paid, as the server names it. */
enum class PayMethod(
    internal val wire: String,
) {
    Upi("upi"),
    Cash("cash"),
    Card("card"),
    Bank("bank"),
    ;

    internal companion object {
        fun of(wire: String?): PayMethod? = entries.firstOrNull { it.wire == wire }
    }
}

/** One row of the month's list. */
data class ExpenseRow(
    val id: String,
    val category: SpendCategory,
    val categoryName: String,
    val day: LocalDate,
    val amountPaise: Long,
    val note: String?,
    val void: Boolean,
    /** Absent on expenses recorded before the method was kept, or without one. */
    val method: PayMethod? = null,
    /** A bill photo is attached; [ExpensesStateHolder.openBill] fetches a link to it. */
    val hasBill: Boolean = false,
    /** Recorded by a recurring expense rather than by hand. */
    val recurring: Boolean = false,
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
    /** The bill photo to upload after the save, a JPEG already resized on the device. */
    val bill: ByteArray? = null,
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
    /** The last expense was saved but its bill photo did not upload; [ExpensesStateHolder.retryBill] tries again. */
    val billFailed: Boolean = false,
    /** A bill being fetched for [ExpensesStateHolder.openBill]. */
    val openingBill: String? = null,
    /** A five-minute link to the bill to open, once; [ExpensesStateHolder.closeBill] drops it. */
    val billLink: String? = null,
    val billLinkFailed: Boolean = false,
    /** Removing a bill photo failed; [ExpensesStateHolder.closeBill] clears it. */
    val billRemoveFailed: Boolean = false,
)
