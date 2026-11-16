package com.aarogyam.staff.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.auth.OtpBoxes
import com.aarogyam.staff.android.ui.patient.V7Icon
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.android.ui.schedule.PreviewNotice
import com.aarogyam.staff.signin.SignInState
import com.aarogyam.staff.signin.SignInStateHolder
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkMorphingBlob
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

private const val CODE_BOXES = 8

/** The lock in the brand blob. */
@Composable
internal fun LockBlob() {
    val p = SkTheme.palette
    Box(Modifier.padding(top = 8.dp, bottom = 18.dp).size(110.dp), contentAlignment = Alignment.Center) {
        SkMorphingBlob(p.primary.color, Modifier.size(110.dp))
        V7Icon("lock", androidx.compose.ui.graphics.Color.White, 44.dp)
    }
}

/** The round back button over the corner. */
@Composable
internal fun BackButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val description = stringResource(R.string.sh_s_a_back)
    Box(
        modifier
            .size(40.dp)
            .background(
                SkTheme.palette.surface2.color
                    .copy(alpha = 0.8f),
                CircleShape,
            ).clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) { V7Icon("back", SkTheme.palette.onSurface.color, 20.dp) }
}

@Composable
internal fun EmailStep(
    holder: SignInStateHolder,
    state: SignInState,
    hasInvite: Boolean,
    onRegister: () -> Unit,
    onInvite: () -> Unit,
) {
    val p = SkTheme.palette
    if (hasInvite) {
        Row(
            Modifier
                .padding(
                    bottom = 14.dp,
                ).background(p.tertiaryContainer.color, CircleShape)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            V7Icon("team", p.onTertiaryContainer.color, 18.dp)
            Text(
                stringResource(R.string.sh_s_a_invite_ready_out),
                style = v7(12.5f, FontWeight.SemiBold),
                color = p.onTertiaryContainer.color,
            )
        }
    }
    Title(stringResource(R.string.sh_s_a_signin_title))
    Text(
        stringResource(R.string.sh_s_a_signin_subtitle),
        style = v7(15f).copy(textAlign = TextAlign.Center),
        color = p.onSurfaceVariant.color,
        modifier = Modifier.padding(top = 6.dp, bottom = 20.dp),
    )
    SkField(
        stringResource(R.string.email_label),
        state.email,
        holder::onEmailChange,
        placeholder = "name@clinic.com",
        error = state.error?.let { stringResource(it.message()) },
        keyboard =
            KeyboardOptions(
                keyboardType = KeyboardType.Email,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Send,
            ),
        actions = KeyboardActions(onSend = { holder.submitEmail() }),
        autofill = ContentType.EmailAddress,
    )
    SkPillButton(
        stringResource(R.string.send_code),
        holder::submitEmail,
        Modifier.padding(top = 12.dp),
        wide = true,
        loading = state.busy,
    )
    Text(
        stringResource(R.string.sh_store_signin_use_password),
        style = v7(13.5f, FontWeight.Bold),
        color = p.primary.color,
        modifier =
            Modifier
                .padding(
                    top = 4.dp,
                ).heightIn(min = 44.dp)
                .clickable(role = Role.Button, onClick = holder::usePassword)
                .padding(top = 12.dp),
    )
    Text(
        stringResource(R.string.sh_s_a_signin_or),
        style = v7(12.5f),
        color = p.onSurfaceVariant.color,
        modifier = Modifier.padding(vertical = 16.dp),
    )
    PreviewNotice(text = stringResource(R.string.sh_s_a_signin_sso_preview))
    Column(
        Modifier.padding(top = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(stringResource(R.string.sh_s_a_signin_new_clinic), style = v7(12f), color = p.onSurfaceVariant.color)
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Link(R.string.sh_s_a_signin_request, onRegister)
            Link(R.string.sh_s_a_signin_have_invite, onInvite)
        }
    }
}

@Composable
private fun Link(
    text: Int,
    onClick: () -> Unit,
) = Text(
    stringResource(text),
    style = v7(12.5f, FontWeight.Bold),
    color = SkTheme.palette.primary.color,
    modifier =
        Modifier
            .heightIn(
                min = 44.dp,
            ).clickable(role = Role.Button, onClick = onClick)
            .padding(vertical = 12.dp),
)

@Composable
private fun Title(text: String) =
    Text(
        text,
        style = v7(29f, FontWeight.ExtraBold).copy(letterSpacing = (-0.6).sp, textAlign = TextAlign.Center),
        color = SkTheme.palette.onSurface.color,
        modifier = Modifier.fillMaxWidth().semantics { heading() },
    )

@Composable
internal fun CodeStep(
    holder: SignInStateHolder,
    state: SignInState,
) {
    val p = SkTheme.palette
    Column(Modifier.fillMaxWidth()) {
        Title(stringResource(R.string.sh_s_a_code_title))
        Text(
            stringResource(R.string.code_sent, state.email),
            style = v7(14f),
            color = p.onSurfaceVariant.color,
            modifier = Modifier.padding(top = 6.dp, bottom = 18.dp),
        )
        OtpBoxes(CODE_BOXES, state.code, holder::onCodeChange, holder::submitCode)
        state.error?.let {
            Text(
                stringResource(it.message()),
                style = v7(12f),
                color = p.error.color,
                modifier = Modifier.padding(top = 10.dp),
            )
        }
        SkPillButton(
            stringResource(R.string.verify_code),
            holder::submitCode,
            Modifier.padding(top = 16.dp),
            wide = true,
            loading = state.busy,
        )
        Text(
            stringResource(R.string.sh_s_a_code_hint),
            style = v7(12f).copy(textAlign = TextAlign.Center),
            color = p.onSurfaceVariant.color,
            modifier = Modifier.fillMaxWidth().padding(top = 14.dp),
        )
    }
}
