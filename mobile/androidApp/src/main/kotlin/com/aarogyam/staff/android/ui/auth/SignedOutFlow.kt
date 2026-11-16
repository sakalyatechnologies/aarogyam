package com.aarogyam.staff.android.ui.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.ui.SignInScreen
import com.aarogyam.staff.android.ui.rememberHolder

private enum class Step { Welcome, SignIn, Register, Invite }

/** What a signed-out person walks through: the welcome pager, then sign-in, registration or the invitation. */
@Composable
fun SignedOutFlow(graph: AppGraph) {
    val pending by PendingInvite.link.collectAsState()
    // A pending invitation (opened from a link) goes straight to sign-in.
    var step by rememberSaveable { mutableStateOf(if (pending != null) Step.SignIn else Step.Welcome) }
    AnimatedContent(step, transitionSpec = {
        (fadeIn() + scaleIn(initialScale = 0.98f)) togetherWith fadeOut()
    }, label = "signed-out") { shown ->
        when (shown) {
            Step.Welcome -> {
                WelcomeScreen({ step = Step.SignIn }, { step = Step.Invite })
            }

            Step.SignIn -> {
                SignInScreen(
                    rememberHolder { graph.signIn(it) },
                    hasInvite = pending != null,
                    onBack = { step = Step.Welcome },
                    onRegister = { step = Step.Register },
                    onInvite = { step = Step.Invite },
                )
            }

            Step.Register -> {
                RegistrationScreen(rememberHolder { graph.registration(it) }) { step = Step.SignIn }
            }

            Step.Invite -> {
                InviteScreen(
                    rememberHolder { graph.invite(it, pending) },
                    signedIn = false,
                    onLink = PendingInvite::set,
                    onContinue = { step = Step.SignIn },
                    onBack = { step = Step.Welcome },
                )
            }
        }
    }
}
