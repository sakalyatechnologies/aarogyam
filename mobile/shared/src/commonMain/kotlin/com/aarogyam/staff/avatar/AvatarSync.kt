package com.aarogyam.staff.avatar

import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.avatarContent
import com.aarogyam.staff.api.model.Avatar
import com.aarogyam.staff.api.putMyAvatarPhoto
import com.aarogyam.staff.api.putMyAvatarPreset
import com.aarogyam.staff.art.AvatarArt
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.device.Preferences
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome

/**
 * Keeps the staff avatar on the server (BK-10) while the device copy stays the cache: the choice in
 * [Preferences] and the photo file the app writes. A save is best effort (the picture shows at once
 * and a failed upload is only logged), and a phone with no choice adopts the server's.
 */
class AvatarSync(
    private val preferences: Preferences,
    private val log: Logger = Logger("aarogyam.avatar"),
) {
    /** Photos of other members already fetched, by the photo path (the link's token changes hourly). */
    private val photos = mutableMapOf<String, ByteArray>()

    /** Saves the chosen illustration [id] on the server. */
    suspend fun savePreset(
        api: ClinicApi,
        id: String,
    ) {
        if (api.putMyAvatarPreset(id) is Outcome.Failure) log.warn("avatar.preset_not_saved")
    }

    /** Saves the device's square JPEG [jpeg] on the server. */
    suspend fun savePhoto(
        api: ClinicApi,
        jpeg: ByteArray,
    ) {
        if (api.putMyAvatarPhoto(jpeg) is Outcome.Failure) log.warn("avatar.photo_not_saved")
    }

    /**
     * When this device has no choice yet and the server has [avatar], adopts it: a known preset
     * becomes the choice; a photo is fetched, handed to [writePhoto] and chosen as [PHOTO]. True when
     * the device choice changed.
     */
    suspend fun pullIfMissing(
        api: ClinicApi,
        avatar: Avatar?,
        writePhoto: (ByteArray) -> Unit,
    ): Boolean {
        if (avatar == null || preferences.get(PreferenceKey.AvatarChoice) != null) return false
        val preset = avatar.preset
        val url = avatar.photoUrl
        if (preset != null && preset in AvatarArt.all) {
            preferences.set(PreferenceKey.AvatarChoice, preset)
            return true
        }
        if (url == null) return false
        val bytes = (api.avatarContent(url) as? Outcome.Success)?.value ?: return false
        writePhoto(bytes)
        preferences.set(PreferenceKey.AvatarChoice, PHOTO)
        return true
    }

    /** Another member's photo bytes, kept for the session; null when there is none or it cannot be fetched. */
    suspend fun photoOf(
        api: ClinicApi,
        avatar: Avatar?,
    ): ByteArray? {
        val url = avatar?.photoUrl ?: return null
        val key = url.substringBefore('?')
        photos[key]?.let { return it }
        val bytes = (api.avatarContent(url) as? Outcome.Success)?.value ?: return null
        photos[key] = bytes
        return bytes
    }

    companion object {
        /** The choice value meaning the photo file on this device. */
        const val PHOTO = "photo"
    }
}
