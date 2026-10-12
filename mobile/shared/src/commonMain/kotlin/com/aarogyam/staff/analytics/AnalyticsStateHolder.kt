package com.aarogyam.staff.analytics

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.analytics
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.todayIn
import kotlin.time.Clock

sealed interface AnalyticsState {
    data class Loading(
        val period: AnalyticsPeriod,
    ) : AnalyticsState

    /** The role lacks `analytics.view` (owner only by default). */
    data object NotAllowed : AnalyticsState

    data class Failed(
        val period: AnalyticsPeriod,
        val error: ScreenError,
    ) : AnalyticsState

    data class Loaded(
        val view: AnalyticsView,
    ) : AnalyticsState
}

/**
 * The Analytics page: one `GET /reports/analytics` per period, covering the bars plus the window
 * before them so every number has a delta. Periods already loaded are kept until [refresh].
 */
class AnalyticsStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.analytics"),
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) {
    private val mutableState = MutableStateFlow<AnalyticsState>(AnalyticsState.Loading(AnalyticsPeriod.Week))
    val state: StateFlow<AnalyticsState> = mutableState.asStateFlow()
    private val cache = mutableMapOf<AnalyticsPeriod, AnalyticsView>()
    private var job: Job? = null

    init {
        if (ANALYTICS_VIEW in
            clinic.permissions
        ) {
            show(AnalyticsPeriod.Week)
        } else {
            mutableState.value = AnalyticsState.NotAllowed
        }
    }

    fun show(period: AnalyticsPeriod) {
        if (mutableState.value == AnalyticsState.NotAllowed) return
        cache[period]?.let {
            mutableState.value = AnalyticsState.Loaded(it)
            return
        }
        load(period)
    }

    fun refresh() {
        if (mutableState.value == AnalyticsState.NotAllowed) return
        cache.clear()
        load(currentPeriod())
    }

    private fun currentPeriod(): AnalyticsPeriod =
        when (val s = mutableState.value) {
            is AnalyticsState.Loading -> s.period
            is AnalyticsState.Failed -> s.period
            is AnalyticsState.Loaded -> s.view.period
            AnalyticsState.NotAllowed -> AnalyticsPeriod.Week
        }

    private fun load(period: AnalyticsPeriod) {
        job?.cancel()
        mutableState.value = AnalyticsState.Loading(period)
        job =
            scope.launch {
                val (bucket, from) = rangeOf(period, today())
                mutableState.value =
                    when (val answer = clinic.api.analytics(bucket, from, today())) {
                        is Outcome.Success -> {
                            AnalyticsState.Loaded(answer.value.toView(period).also { cache[period] = it })
                        }

                        is Outcome.Failure -> {
                            log.warn("analytics.load_failed") { code("error", answer.error.code.value) }
                            AnalyticsState.Failed(period, ScreenError.of(answer.error))
                        }
                    }
            }
    }

    internal companion object {
        const val ANALYTICS_VIEW = "analytics.view"

        /** The bucket and first day for [period], ending [today]: the bars plus the window before them. */
        fun rangeOf(
            period: AnalyticsPeriod,
            today: LocalDate,
        ): Pair<String, LocalDate> {
            val buckets = barsOf(period) + if (period == AnalyticsPeriod.Year) 0 else windowOf(period)
            return when (period) {
                AnalyticsPeriod.Week -> {
                    val monday = today.minus(DatePeriod(days = today.dayOfWeek.ordinal))
                    "week" to monday.minus(DatePeriod(days = DAYS_PER_WEEK * (buckets - 1)))
                }

                AnalyticsPeriod.Month, AnalyticsPeriod.Year -> {
                    "month" to LocalDate(today.year, today.month, 1).minus(DatePeriod(months = buckets - 1))
                }
            }
        }

        private const val DAYS_PER_WEEK = 7
    }
}
