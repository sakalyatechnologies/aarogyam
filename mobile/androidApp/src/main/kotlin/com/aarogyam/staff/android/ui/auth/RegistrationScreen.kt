package com.aarogyam.staff.android.ui.auth

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
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
import com.aarogyam.staff.android.ui.patient.V7Label
import com.aarogyam.staff.android.ui.patient.v7
import com.aarogyam.staff.signin.RegistrationField
import com.aarogyam.staff.signin.RegistrationState
import com.aarogyam.staff.signin.RegistrationStateHolder
import com.aarogyam.staff.signin.Specialty
import com.sakalya.mobile.designcompose.SkCheckDraw
import com.sakalya.mobile.designcompose.SkChoiceChip
import com.sakalya.mobile.designcompose.SkField
import com.sakalya.mobile.designcompose.SkPillButton
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.color

/** "Register your clinic": the same request the web page sends; the form is the holder's, this only draws it. */
@Composable
fun RegistrationScreen(
    holder: RegistrationStateHolder,
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
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                stringResource(R.string.sh_s_a_reg_title),
                style = v7(29f, FontWeight.ExtraBold).copy(letterSpacing = (-0.6).sp),
                color = p.onSurface.color,
                modifier = Modifier.semantics { heading() },
            )
            Text(stringResource(R.string.sh_s_a_reg_subtitle), style = v7(15f), color = p.onSurfaceVariant.color)
            if (state.received) Received(onBack) else Form(holder, state)
        }
        BackButton(onBack, Modifier.align(Alignment.TopStart).padding(start = 12.dp, top = 6.dp))
    }
}

@Composable
private fun Field(
    label: Int,
    value: String,
    onChange: (String) -> Unit,
    error: String? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    autofill: ContentType? = null,
) = SkField(
    stringResource(label),
    value,
    onChange,
    error = error,
    keyboard = KeyboardOptions(keyboardType = keyboard, autoCorrectEnabled = keyboard == KeyboardType.Text),
    autofill = autofill,
)

@Composable
private fun Form(
    holder: RegistrationStateHolder,
    s: RegistrationState,
) {
    fun bad(field: RegistrationField) = field in s.invalid
    val required = stringResource(R.string.sh_s_a_reg_required)
    Field(R.string.sh_s_a_reg_clinic, s.clinicName, { v ->
        holder.update {
            it.copy(clinicName = v)
        }
    }, required.takeIf { bad(RegistrationField.ClinicName) }, autofill = ContentType.Username)
    Field(R.string.sh_s_a_reg_city, s.city, { v ->
        holder.update {
            it.copy(city = v)
        }
    }, required.takeIf { bad(RegistrationField.City) }, autofill = ContentType.AddressLocality)
    Field(R.string.sh_s_a_reg_contact, s.contactName, { v ->
        holder.update {
            it.copy(contactName = v)
        }
    }, required.takeIf { bad(RegistrationField.ContactName) }, autofill = ContentType.PersonFullName)
    Field(
        R.string.email_label,
        s.email,
        { v -> holder.update { it.copy(email = v) } },
        stringResource(R.string.sh_s_a_reg_bad_email).takeIf {
            bad(RegistrationField.Email)
        },
        KeyboardType.Email,
        ContentType.EmailAddress,
    )
    Field(
        R.string.sh_s_a_reg_phone,
        s.phone,
        { v -> holder.update { it.copy(phone = v) } },
        stringResource(R.string.sh_s_a_reg_bad_phone).takeIf {
            bad(RegistrationField.Phone)
        },
        KeyboardType.Phone,
        ContentType.PhoneNumber,
    )
    V7Label(stringResource(R.string.sh_s_a_reg_specialty))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SkChoiceChip(stringResource(R.string.sh_s_a_reg_dental), s.specialty == Specialty.Dental, {
            holder.update { it.copy(specialty = Specialty.Dental) }
        })
        SkChoiceChip(stringResource(R.string.sh_s_a_reg_general), s.specialty == Specialty.General, {
            holder.update { it.copy(specialty = Specialty.General) }
        })
    }
    Field(R.string.sh_s_a_reg_message, s.message, { v -> holder.update { it.copy(message = v) } })
    s.error?.let { Text(stringResource(it.message()), style = v7(12f), color = SkTheme.palette.error.color) }
    SkPillButton(
        stringResource(R.string.sh_s_a_reg_send),
        holder::send,
        Modifier.padding(top = 6.dp),
        wide = true,
        loading = s.sending,
    )
}

@Composable
private fun Received(onBack: () -> Unit) {
    val p = SkTheme.palette
    Column(
        Modifier.fillMaxWidth().padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        SkCheckDraw(Modifier.size(64.dp))
        Text(
            stringResource(R.string.sh_s_a_reg_received),
            style = v7(20f, FontWeight.ExtraBold),
            color = p.onSurface.color,
        )
        Text(
            stringResource(R.string.sh_s_a_reg_received_message),
            style = v7(14f).copy(textAlign = TextAlign.Center),
            color = p.onSurfaceVariant.color,
        )
        SkPillButton(stringResource(R.string.sh_s_a_reg_done), onBack, wide = true)
    }
}
