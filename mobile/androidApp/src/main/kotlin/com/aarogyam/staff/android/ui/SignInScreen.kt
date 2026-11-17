package com.aarogyam.staff.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.signin.SignInError
import com.aarogyam.staff.signin.SignInStateHolder
import com.aarogyam.staff.signin.SignInStep
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Sign-in in the v7 look: a lock in a morphing blob, the email field, then the emailed code in separate boxes. */
@Composable
fun SignInScreen(
    holder: SignInStateHolder,
    hasInvite: Boolean = false,
    onBack: () -> Unit = {},
    onRegister: () -> Unit = {},
    onInvite: () -> Unit = {},
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val back =
        when (state.step) {
            SignInStep.Code -> holder::changeEmail
            SignInStep.Password -> holder::useCode
            SignInStep.Email -> onBack
        }
    BackHandler(onBack = back)
    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(
                    rememberScrollState(),
                ).padding(horizontal = Spacing.XL.dp)
                .padding(top = 56.dp, bottom = Spacing.XXL.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            LockBlob()
            when (state.step) {
                SignInStep.Email -> {
                    EmailStep(holder, state, hasInvite, onRegister, onInvite)
                }

                SignInStep.Code -> {
                    CodeStep(holder, state)
                }

                SignInStep.Password -> {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
                        PasswordStep(holder, state.email, state.password, state.busy, state.error)
                    }
                }
            }
        }
        BackButton(back, Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 6.dp))
    }
}

/** The "Use a password" step (iOS `SignInPasswordStep`): the email, a masked password field and a way back to the emailed code. */
@Composable
private fun PasswordStep(
    holder: SignInStateHolder,
    email: String,
    password: String,
    busy: Boolean,
    error: SignInError?,
) {
    val colors = SkTheme.colors
    val emailError = error.takeIf { it == SignInError.InvalidEmail }?.let { stringResource(it.message()) }
    val passwordError =
        error.takeIf { it != null && it != SignInError.InvalidEmail }?.let {
            stringResource(
                it.message(),
            )
        }
    Text(
        stringResource(R.string.sh_store_signin_password_title),
        style = SkTypography.titleSmall,
        color = colors.text.color,
    )
    SkTextField(
        value = email,
        onValueChange = holder::onEmailChange,
        label = stringResource(R.string.email_label),
        supportingText = emailError,
        isError = emailError != null,
        keyboardOptions =
            KeyboardOptions(
                keyboardType = KeyboardType.Email,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Next,
            ),
    )
    PasswordField(
        value = password,
        onValueChange = holder::onPasswordChange,
        label = stringResource(R.string.sh_store_signin_password_label),
        onDone = holder::submitPassword,
        supportingText = passwordError,
    )
    SkButton(
        stringResource(R.string.sh_store_signin_sign_in),
        holder::submitPassword,
        Modifier.fillMaxWidth(),
        enabled = !busy,
    )
    SkButton(
        stringResource(R.string.sh_store_signin_use_code),
        holder::useCode,
        Modifier.fillMaxWidth(),
        variant = SkButtonVariant.Secondary,
        enabled = !busy,
    )
}
