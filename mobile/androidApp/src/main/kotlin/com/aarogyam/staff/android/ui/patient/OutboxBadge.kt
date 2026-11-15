package com.aarogyam.staff.android.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** "Saved, will send · 2": shown while pictures or notes wait in the outbox. */
@Composable
internal fun OutboxBadge(graph: AppGraph) {
    val pending by graph.outbox.pending.collectAsStateWithLifecycle()
    if (pending <= 0) return
    val p = SkTheme.palette
    Box(
        Modifier
            .defaultMinSize(minHeight = 32.dp)
            .background(p.tertiaryContainer.color, CircleShape)
            .padding(horizontal = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            stringResource(R.string.p9_outbox_badge, pending),
            style = v7(13f, FontWeight.Bold),
            color = p.onTertiaryContainer.color,
        )
    }
}
