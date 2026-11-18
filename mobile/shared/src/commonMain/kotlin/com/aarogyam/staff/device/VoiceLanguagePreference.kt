package com.aarogyam.staff.device

/**
 * Each person's default language for dictated notes (visit and tooth notes), kept on this device.
 * Stored as `user id=tag` pairs under one preference, so people sharing a phone keep their own.
 */
class VoiceLanguagePreference(
    private val preferences: Preferences,
) {
    /** [userId]'s language, English until they pick one. */
    fun of(userId: String?): DictationLanguage =
        userId?.let { pairs()[it] }?.let(DictationLanguage::fromTag) ?: DictationLanguage.English

    fun set(
        userId: String?,
        language: DictationLanguage,
    ) {
        if (userId == null) return
        val next = pairs() + (userId to language.tag)
        preferences.set(
            PreferenceKey.DictationLanguage,
            next.entries.joinToString(SEPARATOR) { "${it.key}=${it.value}" },
        )
    }

    private fun pairs(): Map<String, String> =
        preferences
            .get(PreferenceKey.DictationLanguage)
            .orEmpty()
            .split(SEPARATOR)
            .mapNotNull { pair -> pair.split('=').takeIf { it.size == 2 }?.let { it[0] to it[1] } }
            .toMap()

    private companion object {
        const val SEPARATOR = ";"
    }
}
