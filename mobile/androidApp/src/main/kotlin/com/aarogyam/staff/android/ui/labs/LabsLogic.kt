package com.aarogyam.staff.android.ui.labs

import androidx.annotation.StringRes
import com.aarogyam.staff.android.R

/** One dot of the five-step lab tracker. */
enum class TrackerStep { Done, Current, Todo }

/** The five tracker steps for a case at [current] (0 to 4, null for none): done before it, current at it, to come after. */
fun trackerSteps(current: Int?): List<TrackerStep> =
    (0 until STEPS).map { index ->
        when {
            current == null -> TrackerStep.Todo
            index < current -> TrackerStep.Done
            index == current -> TrackerStep.Current
            else -> TrackerStep.Todo
        }
    }

@StringRes
fun stageTitle(index: Int): Int =
    when (index) {
        0 -> R.string.cn_lv_stage_impression
        1 -> R.string.cn_lv_stage_production
        2 -> R.string.cn_lv_stage_trial
        3 -> R.string.cn_lv_stage_final
        else -> R.string.cn_lv_stage_delivered
    }

private const val STEPS = 5
