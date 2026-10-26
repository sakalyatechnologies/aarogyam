package com.aarogyam.staff.device

import platform.Foundation.NSUserDefaults

/** [Preferences] in the app's standard UserDefaults, under an `aarogyam.` prefix. */
class UserDefaultsPreferences(
    private val defaults: NSUserDefaults = NSUserDefaults.standardUserDefaults,
) : Preferences {
    override fun get(key: PreferenceKey): String? = defaults.stringForKey(name(key))

    override fun set(
        key: PreferenceKey,
        value: String?,
    ) {
        if (value == null) defaults.removeObjectForKey(name(key)) else defaults.setObject(value, name(key))
    }

    private fun name(key: PreferenceKey) = "aarogyam." + key.storageName
}
