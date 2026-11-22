package com.aarogyam.staff.device

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AppearancePreferenceTest {
    @Test
    fun the_phone_decides_until_a_look_is_picked_and_the_pick_is_kept() {
        val preferences = MemoryPreferences()
        val appearance = AppearancePreference(preferences)
        assertEquals(Appearance.System, appearance.state.value)
        appearance.set(Appearance.Dark)
        assertEquals(Appearance.Dark, AppearancePreference(preferences).state.value, "kept for the next launch")
        assertEquals(Appearance.Dark, AppearancePreference.stored(preferences))
        appearance.set(Appearance.System)
        assertNull(preferences.get(PreferenceKey.Appearance), "following the phone stores nothing")
        preferences.set(PreferenceKey.Appearance, "sepia")
        assertEquals(
            Appearance.System,
            AppearancePreference(preferences).state.value,
            "an unknown value follows the phone",
        )
    }
}
