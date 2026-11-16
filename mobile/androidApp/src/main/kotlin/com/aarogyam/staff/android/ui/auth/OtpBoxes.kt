package com.aarogyam.staff.android.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.v7
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/**
 * The sign-in code as separate boxes (iOS `OtpBoxes`): a hidden field takes the typing and the SMS or
 * email one-time-code autofill, the boxes only show it. The current box is outlined and lifted.
 */
@Composable
fun OtpBoxes(
    count: Int,
    code: String,
    onCode: (String) -> Unit,
    onComplete: () -> Unit,
) {
    val p = SkTheme.palette
    val focus = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val label = stringResource(R.string.code_label)
    Box(
        Modifier.fillMaxWidth().clickable(
            interactionSource =
                remember {
                    MutableInteractionSource()
                },
            indication = null,
        ) { focus.requestFocus() },
    ) {
        BasicTextField(
            value = code,
            onValueChange = { new ->
                val digits = new.filter(Char::isDigit).take(count)
                onCode(digits)
                if (digits.length == count) onComplete()
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .alpha(0.02f)
                    .focusRequester(focus)
                    .onFocusChanged { focused = it.isFocused }
                    .semantics {
                        contentType = ContentType.SmsOtpCode
                        contentDescription = label
                    },
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(if (count > 6) 6.dp else 8.dp)) {
            repeat(count) { index ->
                val digit = code.getOrNull(index)
                val active = digit != null || (focused && index == minOf(code.length, count - 1))
                Box(
                    Modifier
                        .weight(1f)
                        .height(56.dp)
                        .offset(y = if (digit != null) (-3).dp else 0.dp)
                        .background(p.surface2.color, RoundedCornerShape(14.dp))
                        .border(
                            2.dp,
                            if (active) p.primary.color else androidx.compose.ui.graphics.Color.Transparent,
                            RoundedCornerShape(14.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        digit?.toString().orEmpty(),
                        style =
                            v7(
                                22f,
                                FontWeight.Bold,
                            ).copy(fontFamily = FontFamily.Monospace, textAlign = TextAlign.Center),
                        color = p.onSurface.color,
                        modifier = Modifier.padding(horizontal = 2.dp),
                    )
                }
            }
        }
    }
}
