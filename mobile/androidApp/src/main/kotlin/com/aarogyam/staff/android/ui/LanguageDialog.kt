package com.aarogyam.staff.android.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.visit.chipLabel
import com.aarogyam.staff.device.DictationLanguage
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkChoiceChips
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** The app's screen languages; [tag] empty follows the phone. */
enum class AppLanguage(
    val tag: String,
    val label: Int,
) {
    System("", R.string.language_system),
    English("en", R.string.language_english),
    Marathi("mr", R.string.language_marathi),
    Hindi("hi", R.string.language_hindi),
    ;

    companion object {
        /** The language chosen in the app, or [System]. */
        fun current(): AppLanguage {
            val tag = AppCompatDelegate.getApplicationLocales().toLanguageTags().substringBefore('-')
            return entries.firstOrNull { it.tag.isNotEmpty() && it.tag == tag } ?: System
        }
    }
}

/**
 * Applies [language] app-wide; AppCompat recreates the activity and stores the choice. Digits stay
 * Latin (`-u-nu-latn`): phone numbers, tokens and fees read the same as on paper and the portal.
 */
fun applyLanguage(language: AppLanguage) {
    val locales =
        when (language) {
            AppLanguage.System -> LocaleListCompat.getEmptyLocaleList()
            else -> LocaleListCompat.forLanguageTags("${language.tag}-u-nu-latn")
        }
    AppCompatDelegate.setApplicationLocales(locales)
}

/**
 * System, English, मराठी or हिंदी; the screens switch as soon as one is picked. Below, the language
 * voice notes are dictated in (visit and tooth notes), kept for this person on this phone.
 */
@Composable
fun LanguageDialog(
    voice: DictationLanguage? = null,
    onVoice: (DictationLanguage) -> Unit = {},
    onDismiss: () -> Unit,
) {
    val current = AppLanguage.current()
    var spoken by remember { mutableStateOf(voice) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.language_title)) },
        text = {
            Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(Spacing.XS.dp)) {
                AppLanguage.entries.forEach { language ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .selectable(selected = language == current, role = Role.RadioButton) {
                                onDismiss()
                                if (language != current) applyLanguage(language)
                            },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
                    ) {
                        RadioButton(
                            selected = language == current,
                            onClick = null,
                            colors = RadioButtonDefaults.colors(selectedColor = SkTheme.colors.primary.color),
                        )
                        Text(
                            stringResource(language.label),
                            style = SkTypography.bodyText,
                            color = SkTheme.colors.text.color,
                        )
                    }
                }
                spoken?.let { chosen ->
                    Text(
                        stringResource(R.string.language_voice),
                        style = SkTypography.bodyStrong,
                        color = SkTheme.colors.text.color,
                        modifier = Modifier.padding(top = Spacing.M.dp),
                    )
                    SkChoiceChips(
                        options = DictationLanguage.entries,
                        selected = setOf(chosen),
                        onToggle = {
                            spoken = it
                            onVoice(it)
                        },
                        label = { it.chipLabel() },
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.walk_in_close)) } },
    )
}
