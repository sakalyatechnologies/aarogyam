package com.aarogyam.staff.today

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.expenses
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.LocalDate
import kotlinx.datetime.todayIn
import kotlin.time.Clock

/** What the Today screen draws. */
sealed interface TodayState {
    data object Loading : TodayState

    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : TodayState

    data class Failed(
        val error: ScreenError,
    ) : TodayState

    /**
     * A finance-only role (no `appointments.read`, with `finance.view`): Today leads with money.
     * [refreshing] and [error] as for [Loaded].
     */
    data class MoneyOnly(
        val money: MoneyView,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : TodayState

    /** [refreshing] while a reload runs; [error] when the last reload failed (data kept). */
    data class Loaded(
        val view: TodayView,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : TodayState
}

/**
 * Today at the open clinic, shown in the clinic's time zone. One load is `GET /today`, plus, with
 * `finance.view`, `GET /today/money` and today's `GET /expenses` beside it (in parallel).
 */
class TodayStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.today"),
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) {
    private val mutableState = MutableStateFlow<TodayState>(TodayState.Loading)

    /** The current screen state. */
    val state: StateFlow<TodayState> = mutableState.asStateFlow()

    init {
        if (APPOINTMENTS_READ in clinic.permissions || FINANCE_VIEW in clinic.permissions) {
            refresh()
        } else {
            mutableState.value = TodayState.NotAllowed
        }
    }

    /** Reloads, keeping what is on screen until the answer arrives. */
    fun refresh() {
        val current = mutableState.value
        when (current) {
            TodayState.NotAllowed -> {
                return
            }

            is TodayState.Loaded -> {
                if (current.refreshing) {
                    return
                } else {
                    mutableState.value =
                        current.copy(refreshing = true, error = null)
                }
            }

            is TodayState.MoneyOnly -> {
                if (current.refreshing) return
                mutableState.value = current.copy(refreshing = true, error = null)
            }

            else -> {
                mutableState.value = TodayState.Loading
            }
        }
        if (APPOINTMENTS_READ !in clinic.permissions) {
            scope.launch { mutableState.value = loadMoneyOnly(current) }
            return
        }
        scope.launch {
            val (result, money) = load()
            mutableState.value =
                when (result) {
                    is Outcome.Success -> {
                        TodayState.Loaded(
                            result.value
                                .toView(
                                    clinic.session.clinic.name,
                                    clinic.session.user.displayName,
                                    clinic.timeZone,
                                    clinic.session.membership.id,
                                    clinic.session.membership.roleKey,
                                ).copy(money = money),
                        )
                    }

                    is Outcome.Failure -> {
                        log.warn("today.load_failed") { code("error", result.error.code.value) }
                        val error = ScreenError.of(result.error)
                        if (current is TodayState.Loaded) {
                            current.copy(
                                refreshing = false,
                                error = error,
                            )
                        } else {
                            TodayState.Failed(error)
                        }
                    }
                }
        }
    }

    /** `GET /today`, and with `finance.view` the money beside it; a money failure only hides the tiles. */
    private suspend fun load() =
        coroutineScope {
            val day = async { clinic.api.today() }
            val money = if (FINANCE_VIEW in clinic.permissions) async { money() } else null
            val moneyView =
                when (val answer = money?.await()) {
                    is Outcome.Success -> {
                        answer.value
                    }

                    is Outcome.Failure -> {
                        log.warn("today.money_failed") { code("error", answer.error.code.value) }
                        null
                    }

                    null -> {
                        null
                    }
                }
            day.await() to moneyView
        }

    private suspend fun loadMoneyOnly(current: TodayState): TodayState =
        when (val answer = money()) {
            is Outcome.Success -> {
                TodayState.MoneyOnly(answer.value)
            }

            is Outcome.Failure -> {
                log.warn("today.money_failed") { code("error", answer.error.code.value) }
                val error = ScreenError.of(answer.error)
                if (current is TodayState.MoneyOnly) {
                    current.copy(
                        refreshing = false,
                        error = error,
                    )
                } else {
                    TodayState.Failed(error)
                }
            }
        }

    /** `GET /today/money` and today's `GET /expenses` together; an expenses failure only blanks that tile. */
    private suspend fun money(): Outcome<MoneyView, ApiError> =
        coroutineScope {
            val day = today()
            val money = async { clinic.api.todayMoney() }
            val spent = async { clinic.api.expenses(day, day) }
            when (val m = money.await()) {
                is Outcome.Failure -> {
                    m
                }

                is Outcome.Success -> {
                    val expenses =
                        when (val e = spent.await()) {
                            is Outcome.Success -> {
                                spentPaise(e.value.items)
                            }

                            is Outcome.Failure -> {
                                log.warn("today.expenses_failed") { code("error", e.error.code.value) }
                                null
                            }
                        }
                    Outcome.Success(m.value.toView().copy(expensesTodayPaise = expenses))
                }
            }
        }

    private companion object {
        const val APPOINTMENTS_READ = "appointments.read"
        const val FINANCE_VIEW = "finance.view"
    }
}
