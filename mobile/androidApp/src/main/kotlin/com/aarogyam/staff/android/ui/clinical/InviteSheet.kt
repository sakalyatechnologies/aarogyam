package com.aarogyam.staff.android.ui.clinical

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.team.InviteStaffStateHolder
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkCheckDraw
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkModalSheet
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** "Invite to the team": an email and a role, then Send invitation; the server emails the sign-in code. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun InviteSheet(
    holder: InviteStaffStateHolder,
    onDone: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    SkModalSheet(stringResource(R.string.cn_c_team_invite_title), onDismiss = onDone) {
        val sent = state.sentTo
        if (sent != null) {
            SkCheckDraw(Modifier.size(64.dp))
            Text(
                stringResource(R.string.cn_c_team_invite_sent, sent),
                style = SkTypography.titleSmall,
                color = p.onSurface.color,
            )
            Text(
                stringResource(R.string.cn_c_team_invite_hint),
                style = SkTypography.footnote,
                color = p.onSurfaceVariant.color,
            )
            SkPillButton(
                stringResource(R.string.cn_c_team_invite_another),
                holder::another,
                variant = SkPillVariant.Tonal,
                wide = true,
            )
            SkPillButton(stringResource(R.string.done), onDone, wide = true)
            return@SkModalSheet
        }
        Text(
            stringResource(R.string.cn_c_team_invite_hint),
            style = SkTypography.footnote,
            color = p.onSurfaceVariant.color,
        )
        SkTextField(
            state.email,
            holder::setEmail,
            stringResource(R.string.cn_c_team_invite_email),
            Modifier.fillMaxWidth(),
            supportingText = if (state.emailInvalid) stringResource(R.string.cn_c_team_invite_email_invalid) else null,
            isError = state.emailInvalid,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
        )
        Text(
            stringResource(R.string.cn_c_team_invite_role),
            style = SkTypography.label,
            color = p.onSurfaceVariant.color,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.S.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.S.dp),
        ) {
            state.roles.forEach { role ->
                SkChoiceChip(role.name, state.roleKey == role.key, { holder.chooseRole(role.key) })
            }
        }
        state.error?.let { Text(stringResource(it.message()), style = SkTypography.footnote, color = p.error.color) }
        SkPillButton(
            stringResource(R.string.cn_c_team_invite_send),
            holder::send,
            wide = true,
            enabled = state.canSend,
            loading = state.sending || state.loadingRoles,
        )
    }
}
