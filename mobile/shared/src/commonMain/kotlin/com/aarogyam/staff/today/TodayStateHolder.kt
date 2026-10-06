package com.aarogyam.staff.today

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the Today screen draws. */
sealed interface TodayState {
    data object Loading : TodayState

    /** The role lacks `appointments.read`; nothing was requested. */
    data object NotAllowed : TodayState

    data class Failed(
        val error: ScreenError,
    ) : TodayState

    /** [refreshing] while a reload runs; [error] when the last reload failed (data kept). */
    data class Loaded(
        val view: TodayView,
        val refreshing: Boolean = false,
        val error: ScreenError? = null,
    ) : TodayState
}

/** Today at the open clinic: one `GET /today` per load, shown in the clinic's time zone. */
class TodayStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.today"),
) {
    private val mutableState = MutableStateFlow<TodayState>(TodayState.Loading)

    /** The current screen state. */
    val state: StateFlow<TodayState> = mutableState.asStateFlow()

    init {
        if (APPOINTMENTS_READ in clinic.permissions) refresh() else mutableState.value = TodayState.NotAllowed
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

            else -> {
                mutableState.value = TodayState.Loading
            }
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

    /** `GET /today`, and with `finance.view` `GET /today/money` beside it; a money failure only hides the tiles. */
    private suspend fun load() =
        coroutineScope {
            val today = async { clinic.api.today() }
            val money =
                if (FINANCE_VIEW in clinic.permissions) {
                    async { clinic.api.todayMoney() }
                } else {
                    null
                }
            val moneyView =
                when (val answer = money?.await()) {
                    is Outcome.Success -> {
                        answer.value.toView()
                    }

                    is Outcome.Failure -> {
                        log.warn("today.money_failed") { code("error", answer.error.code.value) }
                        null
                    }

                    null -> {
                        null
                    }
                }
            today.await() to moneyView
        }

    private companion object {
        const val APPOINTMENTS_READ = "appointments.read"
        const val FINANCE_VIEW = "finance.view"
    }
}
