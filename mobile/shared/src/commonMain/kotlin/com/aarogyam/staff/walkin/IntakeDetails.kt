package com.aarogyam.staff.walkin

import com.aarogyam.staff.api.model.PatientIntake
import kotlinx.datetime.LocalDate

/** A field of the case-paper sections. */
enum class DetailField {
    BloodGroup,
    Language,
    AltPhone,
    EmergencyName,
    EmergencyPhone,
    ReferredBy,
    CallTime,
    Occupation,
    HeardVia,
    HeardViaText,
    DoctorName,
    DoctorPhone,
    DoctorAddress,
    HealthOther,
    AllergiesText,
    DueDate,
}

/** The health checklist code that stands alone. */
const val HEALTH_NONE = "none"

/**
 * The optional case-paper fields as typed: Personal, Contact, Medical history and For women. Phones are digits
 * only. Patient data: shown on screen only, never logged.
 */
data class IntakeDetails(
    val bloodGroup: String = "",
    /** A language tag such as `mr-IN`; empty is the default, English. */
    val language: String = "",
    val altPhone: String = "",
    val emergencyName: String = "",
    val emergencyPhone: String = "",
    val referredBy: String = "",
    val callTime: String = "",
    val occupation: String = "",
    val heardVia: String = "",
    val heardViaText: String = "",
    val doctorName: String = "",
    val doctorPhone: String = "",
    val doctorAddress: String = "",
    val health: Set<String> = emptySet(),
    val healthOther: String = "",
    val allergiesText: String = "",
    val pregnant: Boolean? = null,
    val dueDate: String = "",
    val nursing: Boolean? = null,
) {
    /** One field changed; phones keep ten digits. A pick (blood group, call time, heard via) chosen twice clears. */
    fun with(
        field: DetailField,
        text: String,
    ): IntakeDetails =
        when (field) {
            DetailField.BloodGroup -> copy(bloodGroup = toggled(bloodGroup, text))
            DetailField.Language -> copy(language = toggled(language, text))
            DetailField.CallTime -> copy(callTime = toggled(callTime, text))
            DetailField.HeardVia -> copy(heardVia = toggled(heardVia, text), heardViaText = "")
            DetailField.AltPhone -> copy(altPhone = mobileDigits(text))
            DetailField.EmergencyPhone -> copy(emergencyPhone = mobileDigits(text))
            DetailField.DoctorPhone -> copy(doctorPhone = mobileDigits(text))
            DetailField.EmergencyName -> copy(emergencyName = text.take(MAX_NAME))
            DetailField.ReferredBy -> copy(referredBy = text.take(MAX_NAME))
            DetailField.Occupation -> copy(occupation = text.take(MAX_OCCUPATION))
            DetailField.HeardViaText -> copy(heardViaText = text.take(MAX_NAME))
            DetailField.DoctorName -> copy(doctorName = text.take(MAX_NAME))
            DetailField.DoctorAddress -> copy(doctorAddress = text.take(MAX_LONG))
            DetailField.HealthOther -> copy(healthOther = text.take(MAX_LONG), health = health - HEALTH_NONE)
            DetailField.AllergiesText -> copy(allergiesText = text.take(MAX_LONG))
            DetailField.DueDate -> copy(dueDate = text.take(DATE_LENGTH))
        }

    /** A checklist code ticked or unticked; `none` stands alone, so it clears the rest and any other tick clears it. */
    fun toggleHealth(code: String): IntakeDetails =
        when {
            code == HEALTH_NONE && code in health -> copy(health = emptySet())
            code == HEALTH_NONE -> copy(health = setOf(HEALTH_NONE), healthOther = "")
            code in health -> copy(health = health - code)
            else -> copy(health = health - HEALTH_NONE + code)
        }

    /** Pregnancy answered; anything but "yes" forgets the due date. */
    fun withPregnant(value: Boolean?): IntakeDetails =
        copy(
            pregnant = value,
            dueDate =
                if (value ==
                    true
                ) {
                    dueDate
                } else {
                    ""
                },
        )

    /** The checklist codes to send; null when nothing was ticked. */
    fun healthCodes(): List<String>? = health.toList().takeIf { it.isNotEmpty() }

    /** The case-paper fields to send; null when none was filled. The women's questions go only for [female]. */
    fun toApi(
        female: Boolean,
        masked: Map<DetailField, String> = emptyMap(),
    ): PatientIntake? {
        val intake =
            PatientIntake(
                bloodGroup = bloodGroup.orNull(),
                altPhone = masked[DetailField.AltPhone] ?: altPhone.phoneOrNull(),
                emergencyContactName = emergencyName.orNull(),
                emergencyContactPhone = masked[DetailField.EmergencyPhone] ?: emergencyPhone.phoneOrNull(),
                referredBy = referredBy.orNull(),
                callTime = callTime.orNull(),
                occupation = occupation.orNull(),
                heardVia = heardVia.orNull(),
                heardViaText = heardViaText.takeIf { heardVia.isNotEmpty() }.orNull(),
                familyDoctorName = doctorName.orNull(),
                familyDoctorPhone = masked[DetailField.DoctorPhone] ?: doctorPhone.phoneOrNull(),
                familyDoctorAddress = doctorAddress.orNull(),
                healthOther = healthOther.takeIf { HEALTH_NONE !in health }.orNull(),
                pregnant = pregnant.takeIf { female },
                dueDate = dueDate.takeIf { female && pregnant == true }.orNull(),
                nursing = nursing.takeIf { female },
            )
        return intake.takeIf { it != PatientIntake() }
    }

    /** Problems per field; an empty field is fine, as every field is optional. */
    fun problems(female: Boolean): Map<IntakeField, IntakeProblem> =
        buildMap {
            if (altPhone.isNotEmpty() && !isCompleteMobile(altPhone)) put(IntakeField.AltPhone, IntakeProblem.Invalid)
            if (emergencyPhone.isNotEmpty() && !isCompleteMobile(emergencyPhone)) {
                put(IntakeField.EmergencyPhone, IntakeProblem.Invalid)
            }
            if (doctorPhone.isNotEmpty() && !isCompleteMobile(doctorPhone)) {
                put(IntakeField.DoctorPhone, IntakeProblem.Invalid)
            }
            val badDate = dueDate.isNotEmpty() && runCatching { LocalDate.parse(dueDate) }.isFailure
            if (female && pregnant == true && badDate) put(IntakeField.DueDate, IntakeProblem.Invalid)
        }

    private fun toggled(
        old: String,
        picked: String,
    ) = if (old == picked) "" else picked
}

private fun String?.orNull(): String? = this?.trim()?.takeIf { it.isNotEmpty() }

private fun String.phoneOrNull(): String? = takeIf { it.isNotEmpty() }?.let { "+91$it" }

private const val MAX_NAME = 120
private const val MAX_OCCUPATION = 80
private const val MAX_LONG = 300
private const val DATE_LENGTH = 10

/** Digits typed for a date of birth, shown as `dd/mm/yyyy` (at most eight digits). */
internal fun dobDisplay(typed: String): String {
    val digits = typed.filter { it.isDigit() }.take(DOB_DIGITS)
    return buildString {
        digits.forEachIndexed { i, c ->
            if (i == DOB_DAY_END || i == DOB_MONTH_END) append('/')
            append(c)
        }
    }
}

/** The ISO date of a complete valid `dd/mm/yyyy`; `""` for nothing typed; a marker that fails to parse while incomplete. */
internal fun dobIso(display: String): String {
    if (display.isEmpty()) return ""
    val parts = display.split('/')
    if (display.length != DOB_LENGTH || parts.size != 3) return INCOMPLETE_DOB
    val iso = "${parts[2]}-${parts[1]}-${parts[0]}"
    return if (runCatching { LocalDate.parse(iso) }.isSuccess) iso else INCOMPLETE_DOB
}

private const val INCOMPLETE_DOB = "??"
private const val DOB_DIGITS = 8
private const val DOB_LENGTH = 10
private const val DOB_DAY_END = 2
private const val DOB_MONTH_END = 4

/** A phone the server masked (`+91******3210`) because the role lacks `patients.contact`. Never a number to validate. */
fun isMaskedPhone(phone: String?): Boolean = phone != null && '*' in phone

/** The form for an intake read from the server, and the masked phones it holds (sent back unchanged on save). */
internal fun PatientIntake.toDetails(): Pair<IntakeDetails, Map<DetailField, String>> {
    val masked = mutableMapOf<DetailField, String>()

    fun phone(
        field: DetailField,
        value: String?,
    ): String {
        if (value == null) return ""
        if (isMaskedPhone(value)) {
            masked[field] = value
            return ""
        }
        return mobileDigits(value)
    }
    val details =
        IntakeDetails(
            bloodGroup = bloodGroup.orEmpty(),
            altPhone = phone(DetailField.AltPhone, altPhone),
            emergencyName = emergencyContactName.orEmpty(),
            emergencyPhone = phone(DetailField.EmergencyPhone, emergencyContactPhone),
            referredBy = referredBy.orEmpty(),
            callTime = callTime.orEmpty(),
            occupation = occupation.orEmpty(),
            heardVia = heardVia.orEmpty(),
            heardViaText = heardViaText.orEmpty(),
            doctorName = familyDoctorName.orEmpty(),
            doctorPhone = phone(DetailField.DoctorPhone, familyDoctorPhone),
            doctorAddress = familyDoctorAddress.orEmpty(),
            healthOther = healthOther.orEmpty(),
            pregnant = pregnant,
            dueDate = dueDate.orEmpty(),
            nursing = nursing,
        )
    return details to masked
}
