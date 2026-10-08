package com.aarogyam.staff.walkin

import com.aarogyam.staff.api.model.DeskConsentFields
import com.aarogyam.staff.api.model.NewPatient
import com.aarogyam.staff.api.model.WalkInRequest
import com.aarogyam.staff.patients.Sex

/** A complete Indian mobile number: ten digits starting 6 to 9. */
internal fun isCompleteMobile(digits: String): Boolean = MOBILE.matches(digits)

private val MOBILE = Regex("^[6-9]\\d{9}$")
private const val MIN_NAME = 2
private const val MAX_AGE = 120

/** What the desk typed into the mobile field, kept to digits (a pasted `+91` or spaces drop out). */
internal fun mobileDigits(typed: String): String {
    val digits = typed.filter { it.isDigit() }
    return if (digits.length > MOBILE_DIGITS && digits.startsWith("91")) digits.drop(2) else digits.take(MOBILE_DIGITS)
}

private const val MOBILE_DIGITS = 10

/**
 * The one-step walk-in request for [form], or the problem that stops it. Care consent is always
 * given (verbally) at the desk; reminders only when ticked.
 */
internal fun walkInRequest(form: WalkInForm): Result<WalkInRequest> {
    val consents =
        buildList {
            add(DeskConsentFields(method = VERBAL, purpose = "care"))
            if (form.reminders) add(DeskConsentFields(method = VERBAL, purpose = "reminders"))
        }
    val base =
        WalkInRequest(
            allergies = form.allergies.toList().takeIf { it.isNotEmpty() },
            noKnownAllergies = form.noKnownAllergies.takeIf { it },
            consents = consents,
            practitionerId = form.doctorId,
        )
    val who = form.who
    if (who is Who.Existing) return Result.Ok(base.copy(patientId = who.id))
    if (who == Who.None && form.mobile.isNotEmpty()) return Result.Problem(WalkInProblem.PickPatient)
    if (form.name.trim().length < MIN_NAME) return Result.Problem(WalkInProblem.NameRequired)
    val age = form.age.takeIf { it.isNotEmpty() }?.toIntOrNull()
    if (form.age.isNotEmpty() && (age == null || age > MAX_AGE)) return Result.Problem(WalkInProblem.AgeInvalid)
    return Result.Ok(
        base.copy(
            patient =
                NewPatient(
                    fullName = form.name.trim(),
                    ageYears = age,
                    phone = form.mobile.takeIf { it.isNotEmpty() }?.let { "+91$it" },
                    sex = form.sex?.wire(),
                ),
        ),
    )
}

/** A built request or the problem the form shows. */
internal sealed interface Result<out T> {
    data class Ok<T>(
        val value: T,
    ) : Result<T>

    data class Problem(
        val problem: WalkInProblem,
    ) : Result<Nothing>
}

private const val VERBAL = "verbal"

private fun Sex.wire(): String =
    when (this) {
        Sex.Female -> "female"
        Sex.Male -> "male"
        Sex.Other -> "other"
        Sex.Unknown -> "unknown"
    }
