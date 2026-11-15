package com.aarogyam.staff.android.ui.patient

import com.aarogyam.staff.art.Icons
import com.sakalya.mobile.design.PathData
import com.sakalya.mobile.design.PathParse

/** The few line icons this page needs beyond the shared v7 set (the iOS page uses SF Symbols for them). */
internal object PatientIcons {
    private const val EYE =
        "M2 12C5 7 8.5 5 12 5C15.5 5 19 7 22 12C19 17 15.5 19 12 19C8.5 19 5 17 2 12Z M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12Z"
    private const val EYE_OFF = "$EYE M4 4L20 20"
    private const val LOCK = "M6 11H18V20H6Z M8 11V8A4 4 0 0 1 16 8V11"

    private val own: Map<String, PathData> =
        mapOf("eye" to EYE, "eye_off" to EYE_OFF, "lock_fill" to LOCK)
            .mapNotNull { (name, d) ->
                (PathData.parse(d) as? PathParse.Parsed)?.let { name to it.path }
            }.toMap()

    /** The icon [name]: this page's own, else the shared set. */
    fun of(name: String): PathData = own[name] ?: Icons.of(name)
}
