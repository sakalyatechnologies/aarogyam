package com.aarogyam.staff.android.device

import android.content.Context
import androidx.core.content.edit
import com.aarogyam.staff.device.PreferenceKey
import com.aarogyam.staff.device.Preferences

/** [Preferences] in a private SharedPreferences file. */
class SharedPreferencesStore(
    context: Context,
) : Preferences {
    private val prefs = context.getSharedPreferences("aarogyam_prefs", Context.MODE_PRIVATE)

    override fun get(key: PreferenceKey): String? = prefs.getString(key.storageName, null)

    override fun set(
        key: PreferenceKey,
        value: String?,
    ) {
        prefs.edit { if (value == null) remove(key.storageName) else putString(key.storageName, value) }
    }
}
