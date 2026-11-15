package com.aarogyam.staff.android.ui.visit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.visit.VisitShareState
import com.aarogyam.staff.visit.VisitShareStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/**
 * "Share visit summary" on the closed visit: makes the seven-day link and PIN and sends them by WhatsApp.
 * The message holds the link and the PIN only, never the patient's name; the PIN is shown once.
 */
@Composable
internal fun VisitShareSummary(
    holder: VisitShareStateHolder,
    phone: String?,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var cannot by remember { mutableStateOf(false) }
    val colors = SkTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
        when (val current = state) {
            VisitShareState.Idle -> {
                SkButton(
                    stringResource(R.string.vv_v9v_share_action),
                    onClick = holder::share,
                    variant = SkButtonVariant.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            VisitShareState.Creating -> {
                Muted(stringResource(R.string.vv_v9v_share_creating))
            }

            is VisitShareState.Failed -> {
                ErrorLine(stringResource(current.error.message()))
                SkButton(
                    stringResource(R.string.try_again),
                    onClick = holder::share,
                    variant = SkButtonVariant.Secondary,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            is VisitShareState.Ready -> {
                val text = stringResource(R.string.vv_v9v_share_message, current.url, current.pin)
                SkCard {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.M.dp)) {
                        Muted(stringResource(R.string.vv_v9v_share_pin))
                        Text(current.pin, style = SkTypography.largeTitle, color = colors.text.color)
                        Muted(stringResource(R.string.vv_v9v_share_note))
                        SkButton(
                            stringResource(R.string.vv_v9v_share_whatsapp),
                            onClick = { cannot = !openUri(context, whatsAppUri(phone, text)) },
                            modifier = Modifier.fillMaxWidth(),
                        )
                        if (cannot) ErrorLine(stringResource(R.string.vv_v9v_share_cannot))
                    }
                }
            }
        }
    }
}
