package com.aarogyam.staff.device

/** A setting kept on this device only: not secret, not synced, gone when the app is removed. */
enum class PreferenceKey(
    val storageName: String,
) {
    /** Which illustrated avatar the person picked, by its art ID. */
    AvatarChoice("avatar_choice"),

    /** The language last used for dictation, as a [DictationLanguage] tag. */
    DictationLanguage("dictation_language"),
}

/**
 * Small device settings (SharedPreferences on Android, UserDefaults on iOS). Never holds tokens,
 * health data or anything that identifies a patient.
 */
interface Preferences {
    /** The stored value, or null when none was set. */
    fun get(key: PreferenceKey): String?

    /** Stores [value], or removes the key when it is null. */
    fun set(
        key: PreferenceKey,
        value: String?,
    )
}

/** Preferences held in memory: the default before a platform store is passed, and for tests. */
class MemoryPreferences : Preferences {
    private val values = mutableMapOf<PreferenceKey, String>()

    override fun get(key: PreferenceKey): String? = values[key]

    override fun set(
        key: PreferenceKey,
        value: String?,
    ) {
        if (value == null) values.remove(key) else values[key] = value
    }
}
