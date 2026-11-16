package com.aarogyam.staff.android.ui.doctor

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.aarogyam.staff.android.R

/** "42 y · Female"; the parts that are missing are left out (iOS `DoctorV10Format.ageSex`). */
@Composable
fun ageSex(
    age: Int?,
    sex: String,
): String {
    val sexText =
        when (sex.lowercase()) {
            "male" -> stringResource(R.string.sh_dv10_sex_male)
            "female" -> stringResource(R.string.sh_dv10_sex_female)
            "other" -> stringResource(R.string.sh_dv10_sex_other)
            else -> null
        }
    return listOfNotNull(age?.let { stringResource(R.string.sh_dv10_age, it.toString()) }, sexText).joinToString(" · ")
}
