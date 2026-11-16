package com.aarogyam.staff.android.ui

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.signin.SignInError
import com.aarogyam.staff.signin.SignInStateHolder
import com.aarogyam.staff.signin.SignInStep
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** Email, then the emailed code. */
@Composable
fun SignInScreen(holder: SignInStateHolder) {
    val state by holder.state.collectAsStateWithLifecycle()
    val colors = SkTheme.colors
    // The sign-in screen has no dark header, so the status bar icons follow the page.
    val view = LocalView.current
    val darkTheme = isSystemInDarkTheme()
    DisposableEffect(darkTheme) {
        val controller = (view.context as? Activity)?.window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.isAppearanceLightStatusBars = !darkTheme
        onDispose { controller?.isAppearanceLightStatusBars = false }
    }
    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
            .padding(Spacing.XL.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(stringResource(R.string.app_name), style = SkTypography.overline, color = colors.primaryText.color)
        Text(stringResource(R.string.sign_in_title), style = SkTypography.largeTitle, color = colors.text.color)
        Text(
            stringResource(R.string.sign_in_subtitle),
            style = SkTypography.bodyText,
            color = colors.textMuted.color,
            modifier = Modifier.padding(top = Spacing.XS.dp, bottom = Spacing.XL.dp),
        )
        SkCard {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.ML.dp)) {
                val error = state.error?.let { stringResource(it.message()) }
                when (state.step) {
                    SignInStep.Email -> {
                        SkTextField(
                            value = state.email,
                            onValueChange = holder::onEmailChange,
                            label = stringResource(R.string.email_label),
                            supportingText = error,
                            isError = error != null,
                            keyboardOptions =
                                KeyboardOptions(
                                    keyboardType = KeyboardType.Email,
                                    autoCorrectEnabled = false,
                                    imeAction = ImeAction.Send,
                                ),
                        )
                        SkButton(
                            stringResource(R.string.send_code),
                            holder::submitEmail,
                            Modifier.fillMaxWidth(),
                            enabled = !state.busy,
                        )
                        SkButton(
                            stringResource(R.string.sh_store_signin_use_password),
                            holder::usePassword,
                            Modifier.fillMaxWidth(),
                            variant = SkButtonVariant.Secondary,
                            enabled = !state.busy,
                        )
                    }

                    SignInStep.Password -> {
                        PasswordStep(holder, state.email, state.password, state.busy, state.error)
                    }

                    SignInStep.Code -> {
                        Text(
                            stringResource(R.string.code_sent, state.email),
                            style = SkTypography.bodyText,
                            color = colors.text.color,
                        )
                        SkTextField(
                            value = state.code,
                            onValueChange = holder::onCodeChange,
                            label = stringResource(R.string.code_label),
                            supportingText = error,
                            isError = error != null,
                            keyboardOptions =
                                KeyboardOptions(
                                    keyboardType = KeyboardType.NumberPassword,
                                    imeAction = ImeAction.Done,
                                ),
                        )
                        SkButton(
                            stringResource(R.string.verify_code),
                            holder::submitCode,
                            Modifier.fillMaxWidth(),
                            enabled = !state.busy,
                        )
                        SkButton(
                            stringResource(R.string.change_email),
                            holder::changeEmail,
                            Modifier.fillMaxWidth(),
                            variant = SkButtonVariant.Secondary,
                            enabled = !state.busy,
                        )
                    }
                }
            }
        }
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
