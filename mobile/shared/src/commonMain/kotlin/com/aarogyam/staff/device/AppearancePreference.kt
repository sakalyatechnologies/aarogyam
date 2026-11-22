package com.aarogyam.staff.device

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Light or dark look: the phone's setting, or one picked in More (kept on this phone). */
enum class Appearance(
    internal val wire: String,
) {
    System("system"),
    Light("light"),
    Dark("dark"),
    ;

    companion object {
        internal fun of(wire: String?): Appearance = entries.firstOrNull { it.wire == wire } ?: System
    }
}

/** The app's light or dark look on this device ([PreferenceKey.Appearance]); every platform applies [state]. */
class AppearancePreference(
    private val preferences: Preferences,
) {
    private val mutableState = MutableStateFlow(Appearance.of(preferences.get(PreferenceKey.Appearance)))
    val state: StateFlow<Appearance> = mutableState.asStateFlow()

    fun set(appearance: Appearance) {
        preferences.set(PreferenceKey.Appearance, appearance.wire.takeIf { appearance != Appearance.System })
        mutableState.value = appearance
    }

    companion object {
        /** What [preferences] holds, for a platform that applies the look before the graph exists. */
        fun stored(preferences: Preferences): Appearance = Appearance.of(preferences.get(PreferenceKey.Appearance))
    }
}
