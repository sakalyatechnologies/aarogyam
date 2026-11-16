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
import kotlinx.datetime.LocalDate
import kotlinx.datetime.todayIn
import kotlin.time.Clock

sealed interface AnalyticsState {
    data class Loading(
        val range: AnalyticsRange,
    ) : AnalyticsState

    /** The role lacks `analytics.view` (owner only by default). */
    data object NotAllowed : AnalyticsState

    data class Failed(
        val range: AnalyticsRange,
        val error: ScreenError,
    ) : AnalyticsState

    data class Loaded(
        val view: AnalyticsView,
    ) : AnalyticsState
}

/**
 * The Analytics page: `GET /reports/analytics` for the range (buckets, breakdowns and heat maps all
 * cover exactly those days), then once more for the range of the same length before it, which only
 * feeds the deltas: the page shows at once and the deltas fill in. Ranges already loaded are kept
 * until [refresh].
 */
class AnalyticsStateHolder(
    private val clinic: ClinicContext,
    private val scope: CoroutineScope,
    private val log: Logger = Logger("aarogyam.analytics"),
    private val today: () -> LocalDate = { Clock.System.todayIn(clinic.timeZone) },
) {
    private val mutableState =
        MutableStateFlow<AnalyticsState>(AnalyticsState.Loading(AnalyticsRange.of(AnalyticsPreset.Week, today())))
    val state: StateFlow<AnalyticsState> = mutableState.asStateFlow()
    private val cache = mutableMapOf<AnalyticsRange, AnalyticsView>()
    private var job: Job? = null

    /** The picker's bounds: the newest day and the longest span. */
    val latestDay: LocalDate get() = today()
    val maxDays: Int get() = AnalyticsRange.MAX_DAYS

    init {
        if (ANALYTICS_VIEW in clinic.permissions) {
            show(AnalyticsPreset.Week)
        } else {
            mutableState.value = AnalyticsState.NotAllowed
        }
    }

    /** Shows a preset ending today ([AnalyticsPreset.Custom] shows the year until dates are picked). */
    fun show(preset: AnalyticsPreset) {
        if (mutableState.value == AnalyticsState.NotAllowed) return
        open(AnalyticsRange.of(preset, today()))
    }

    /** Shows the days between the two dates, in either order, trimmed to today and to 731 days. */
    fun showCustom(
        first: LocalDate,
        second: LocalDate,
    ) {
        if (mutableState.value == AnalyticsState.NotAllowed) return
        open(AnalyticsRange.custom(first, second, today()))
    }

    fun refresh() {
        if (mutableState.value == AnalyticsState.NotAllowed) return
        val range = currentRange()
        cache.clear()
        load(range)
    }

    private fun open(range: AnalyticsRange) {
        cache[range]?.let {
            job?.cancel()
            mutableState.value = AnalyticsState.Loaded(it)
            return
        }
        load(range)
    }

    private fun currentRange(): AnalyticsRange =
        when (val s = mutableState.value) {
            is AnalyticsState.Loading -> s.range
            is AnalyticsState.Failed -> s.range
            is AnalyticsState.Loaded -> s.view.range
            AnalyticsState.NotAllowed -> AnalyticsRange.of(AnalyticsPreset.Week, today())
        }

    private fun load(range: AnalyticsRange) {
        job?.cancel()
        mutableState.value = AnalyticsState.Loading(range)
        job =
            scope.launch {
                when (val answer = clinic.api.analytics(range.bucket.wire, range.from, range.to)) {
                    is Outcome.Failure -> {
                        log.warn("analytics.load_failed") { code("error", answer.error.code.value) }
                        mutableState.value = AnalyticsState.Failed(range, ScreenError.of(answer.error))
                    }

                    is Outcome.Success -> {
                        val now = answer.value
                        val first = now.toView(range, null).also { cache[range] = it }
                        mutableState.value = AnalyticsState.Loaded(first)
                        val before = range.previous()
                        when (val older = clinic.api.analytics(before.bucket.wire, before.from, before.to)) {
                            is Outcome.Success -> {
                                val full = now.toView(range, older.value).also { cache[range] = it }
                                mutableState.value = AnalyticsState.Loaded(full)
                            }

                            is Outcome.Failure -> {
                                log.warn("analytics.previous_failed") { code("error", older.error.code.value) }
                            }
                        }
                    }
                }
            }
    }

    internal companion object {
        const val ANALYTICS_VIEW = "analytics.view"
    }
}
