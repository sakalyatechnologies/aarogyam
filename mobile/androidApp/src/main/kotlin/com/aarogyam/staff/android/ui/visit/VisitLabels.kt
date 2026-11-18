package com.aarogyam.staff.android.ui.visit

import androidx.annotation.StringRes
import com.aarogyam.staff.android.R
import com.aarogyam.staff.device.DictationLanguage
import com.aarogyam.staff.visit.BulletKind
import com.aarogyam.staff.visit.NoteSave
import com.sakalya.mobile.designcompose.SkTone

@StringRes
internal fun BulletKind.label(): Int =
    when (this) {
        BulletKind.Complaint -> R.string.vv_c_visit_kind_complaint
        BulletKind.Finding -> R.string.vv_c_visit_kind_finding
        BulletKind.Advice -> R.string.vv_c_visit_kind_advice
        BulletKind.Dictated -> R.string.vv_c_visit_kind_dictated
    }

@StringRes
internal fun NoteSave.label(): Int =
    when (this) {
        NoteSave.Empty -> R.string.vv_c_visit_save_empty
        NoteSave.Unsaved -> R.string.vv_c_visit_save_unsaved
        NoteSave.Saving -> R.string.vv_c_visit_save_saving
        NoteSave.Saved -> R.string.vv_c_visit_save_saved
        NoteSave.Signed -> R.string.vv_c_visit_save_signed
        NoteSave.Failed -> R.string.vv_c_visit_save_failed
    }

internal fun NoteSave.tone(): SkTone =
    when (this) {
        NoteSave.Empty -> SkTone.Neutral
        NoteSave.Unsaved, NoteSave.Saving -> SkTone.Warning
        NoteSave.Saved, NoteSave.Signed -> SkTone.Success
        NoteSave.Failed -> SkTone.Danger
    }

/** Each language in its own script. */
internal fun DictationLanguage.chipLabel(): String =
    when (this) {
        DictationLanguage.English -> "English"
        DictationLanguage.Hindi -> "हिन्दी"
        DictationLanguage.Marathi -> "मराठी"
        DictationLanguage.Gujarati -> "ગુજરાતી"
    }
