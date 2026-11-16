package com.aarogyam.staff.android.ui.schedule

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.art.Icons
import com.sakalya.mobile.designcompose.SkIcon
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** The tertiary pill that marks a part that needs server support (iOS `PreviewNotice`). */
@Composable
internal fun PreviewNotice(
    modifier: Modifier = Modifier,
    text: String = stringResource(R.string.sh_s_preview),
) {
    val p = SkTheme.palette
    Row(
        modifier.background(p.tertiaryContainer.color, CircleShape).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SkIcon(Icons.of("spark"), p.onTertiaryContainer.color, size = 16.dp)
        Text(text, style = v7(12f), color = p.onTertiaryContainer.color)
    }
}
