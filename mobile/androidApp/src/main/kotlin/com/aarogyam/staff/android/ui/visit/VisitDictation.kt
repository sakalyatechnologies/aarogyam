package com.aarogyam.staff.android.ui.visit

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.aarogyam.staff.device.DictationLanguage
import com.aarogyam.staff.visit.VisitStateHolder

/** Starts dictation after the `RECORD_AUDIO` permission: asks once, then listens in the language. */
@Composable
internal fun rememberDictationStarter(
    holder: VisitStateHolder,
    onStarted: () -> Unit = {},
): (DictationLanguage) -> Unit = rememberMicStarter({ holder.listen(it) }, onStarted)

/** [listen] in the language once `RECORD_AUDIO` is granted (asked each time; the system remembers). */
@Composable
internal fun rememberMicStarter(
    listen: (DictationLanguage) -> Unit,
    onStarted: () -> Unit = {},
): (DictationLanguage) -> Unit {
    var wanted by remember { mutableStateOf<DictationLanguage?>(null) }
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val language = wanted
            wanted = null
            if (granted && language != null) {
                listen(language)
                onStarted()
            }
        }
    return { language ->
        wanted = language
        launcher.launch(Manifest.permission.RECORD_AUDIO)
    }
}
