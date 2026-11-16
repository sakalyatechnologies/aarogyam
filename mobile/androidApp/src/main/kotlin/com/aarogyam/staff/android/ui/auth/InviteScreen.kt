package com.aarogyam.staff.android.ui.auth

import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.BackButton
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.patient.V7Icon
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.signin.InviteState
import com.aarogyam.staff.signin.InviteStateHolder
import com.sakalya.mobile.designcompose.SkCheckDraw
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkLoadingIndicator
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkPillVariant
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * Joining a clinic from an invitation link, in two places: signed out it takes the link (pasted or opened
 * through `aarogyam://invite#...`) and sends the person on to sign in; signed in it accepts the invitation.
 * The link and token stay in memory; they are never logged or stored.
 */
@Composable
fun InviteScreen(
    holder: InviteStateHolder,
    signedIn: Boolean,
    onLink: (String) -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    val p = SkTheme.palette
    BackHandler(onBack = onBack)
    Box(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(
                    rememberScrollState(),
                ).padding(horizontal = 24.dp)
                .padding(top = 64.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                stringResource(R.string.sh_s_a_invite_title),
                style = v7(29f, FontWeight.ExtraBold).copy(letterSpacing = (-0.6).sp),
                color = p.onSurface.color,
                modifier = Modifier.semantics { heading() },
            )
            when (val s = state) {
                InviteState.NeedsLink -> {
                    PasteLink(holder, bad = false, onLink = onLink)
                }

                InviteState.BadLink -> {
                    PasteLink(holder, bad = true, onLink = onLink)
                }

                InviteState.Ready -> {
                    Ready(holder, signedIn, onContinue, onBack)
                }

                InviteState.Joining -> {
                    SkLoadingIndicator(
                        stringResource(R.string.sh_s_a_invite_joining),
                        Modifier.fillMaxWidth().padding(top = 30.dp),
                    )
                }

                is InviteState.Joined -> {
                    Joined(onContinue)
                }

                is InviteState.Failed -> {
                    Text(stringResource(s.error.message()), style = v7(14f), color = p.error.color)
                    SkPillButton(stringResource(R.string.try_again), holder::forget, wide = true)
                }
            }
        }
        if (!signedIn) BackButton(onBack, Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 6.dp))
    }
}

@Composable
private fun PasteLink(
    holder: InviteStateHolder,
    bad: Boolean,
    onLink: (String) -> Unit,
) {
    val p = SkTheme.palette
    var pasted by rememberSaveable { mutableStateOf("") }
    val context = LocalContext.current

    fun use(text: String) {
        holder.useLink(text)
        onLink(text)
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sh_s_a_invite_message), style = v7(15f), color = p.onSurfaceVariant.color)
        SkField(
            stringResource(R.string.sh_s_a_invite_link),
            pasted,
            { pasted = it },
            placeholder = "https://…/invite#…",
            error = stringResource(R.string.sh_s_a_invite_bad_link).takeIf { bad },
            keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SkPillButton(
                stringResource(R.string.sh_s_a_invite_paste),
                {
                    val clip = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                    clip?.primaryClip?.getItemAt(0)?.text?.toString()?.let {
                        pasted = it
                        use(it)
                    }
                },
                Modifier.weight(1f),
                variant = SkPillVariant.Tonal,
                wide = true,
            )
            SkPillButton(stringResource(R.string.sh_s_a_invite_use), {
                use(pasted)
            }, Modifier.weight(1f), wide = true, enabled = pasted.isNotBlank())
        }
        Text(stringResource(R.string.sh_s_a_invite_where), style = v7(12f), color = p.onSurfaceVariant.color)
    }
}

@Composable
private fun Ready(
    holder: InviteStateHolder,
    signedIn: Boolean,
    onContinue: () -> Unit,
    onBack: () -> Unit,
) {
    val p = SkTheme.palette
    var name by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(
            Modifier.fillMaxWidth().background(p.card.color, RoundedCornerShape(20.dp)).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(52.dp).background(p.primaryContainer.color, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                V7Icon("team", p.onPrimaryContainer.color, 26.dp)
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    stringResource(R.string.sh_s_a_invite_ready),
                    style = v7(16f, FontWeight.Bold),
                    color = p.onSurface.color,
                )
                Text(
                    stringResource(if (signedIn) R.string.sh_s_a_invite_ready_in else R.string.sh_s_a_invite_ready_out),
                    style = v7(13f),
                    color = p.onSurfaceVariant.color,
                )
            }
        }
        if (signedIn) {
            SkField(
                stringResource(R.string.sh_s_a_invite_name),
                name,
                { name = it },
                autofill = ContentType.PersonFullName,
            )
            SkPillButton(stringResource(R.string.sh_s_a_invite_join), {
                holder.accept(name)
            }, variant = SkPillVariant.Warm, wide = true)
            SkPillButton(
                stringResource(R.string.sh_s_a_invite_not_now),
                onBack,
                variant = SkPillVariant.Ghost,
                wide = true,
            )
        } else {
            SkPillButton(stringResource(R.string.sh_s_a_invite_sign_in), onContinue, wide = true)
        }
    }
}

@Composable
private fun Joined(onContinue: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        SkCheckDraw(Modifier.size(64.dp))
        Text(
            stringResource(R.string.sh_s_a_invite_joined),
            style = v7(20f, FontWeight.ExtraBold).copy(textAlign = TextAlign.Center),
            color = SkTheme.palette.onSurface.color,
        )
        SkPillButton(stringResource(R.string.sh_s_a_invite_continue), onContinue, wide = true)
    }
}
