package com.aarogyam.staff.walkin

import com.aarogyam.staff.api.addFamily
import com.aarogyam.staff.api.model.NewFamilyLink
import com.aarogyam.staff.api.model.NewPatient
import com.aarogyam.staff.api.registerPatient
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.patients.Sex
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import kotlinx.datetime.LocalDate

/** What a family member is to the main person (`POST /patients/{id}/family` `relation`). */
enum class MemberRelation(
    val wire: String,
) {
    Child("child"),
    Spouse("spouse"),
    Parent("parent"),
}

/** One person the visit is also for. Patient data: never logged. [phone] empty means the main person's. */
data class FamilyMemberForm(
    val key: Int,
    val name: String = "",
    val dateOfBirth: String = "",
    val age: String = "",
    val sex: Sex? = null,
    val relation: MemberRelation = MemberRelation.Child,
    val phone: String = "",
)

/** How one family member ended: [patientId] is null when the profile was not made, [linked] when the link failed. */
data class FamilyResult(
    val key: Int,
    val name: String,
    val patientId: String?,
    val linked: Boolean,
) {
    val failed: Boolean get() = patientId == null || !linked
}

private const val MIN_NAME = 2
private const val MAX_AGE = 120

/** Per-member problems for the members that cannot be sent. */
internal fun memberProblems(
    members: List<FamilyMemberForm>,
    today: LocalDate,
): Map<Int, Map<IntakeField, IntakeProblem>> =
    members
        .associate { member ->
            member.key to
                buildMap {
                    if (member.name.trim().length < MIN_NAME) put(IntakeField.Name, IntakeProblem.Required)
                    if (member.phone.isNotEmpty() && !isCompleteMobile(member.phone)) {
                        put(IntakeField.Phone, IntakeProblem.Invalid)
                    }
                    memberBirthProblem(member, today)?.let { put(IntakeField.Birth, it) }
                }
        }.filterValues { it.isNotEmpty() }

private fun memberBirthProblem(
    member: FamilyMemberForm,
    today: LocalDate,
): IntakeProblem? {
    if (member.dateOfBirth.isNotEmpty()) {
        val date = runCatching { LocalDate.parse(member.dateOfBirth) }.getOrNull() ?: return IntakeProblem.Invalid
        return if (date > today) IntakeProblem.InFuture else null
    }
    val age = member.age.toIntOrNull() ?: return IntakeProblem.Required
    return if (age > MAX_AGE) IntakeProblem.Invalid else null
}

/** The `POST /patients` body for [member]; the phone falls back to [mainPhone] (ten digits, maybe empty). */
internal fun memberPatient(
    member: FamilyMemberForm,
    mainPhone: String,
): NewPatient {
    val phone = member.phone.ifEmpty { mainPhone }
    return NewPatient(
        fullName = member.name.trim(),
        ageYears = member.age.toIntOrNull()?.takeIf { member.dateOfBirth.isEmpty() },
        dateOfBirth = member.dateOfBirth.takeIf { it.isNotEmpty() },
        phone = phone.takeIf { it.isNotEmpty() }?.let { "+91$it" },
        sex = member.sex?.wire(),
    )
}

/**
 * Makes each member's own profile (`POST /patients`), then links it to [mainId] (`POST /patients/{id}/family`),
 * one after another. A failure keeps what was made and goes on with the next member; each result says what held.
 */
internal suspend fun createFamily(
    clinic: ClinicContext,
    log: Logger,
    mainId: String,
    mainPhone: String,
    members: List<FamilyMemberForm>,
): List<FamilyResult> =
    members.map { member ->
        val made = clinic.api.registerPatient(memberPatient(member, mainPhone))
        if (made is Outcome.Failure) {
            log.warn("intake.family_create_failed") { code("error", made.error.code.value) }
            return@map FamilyResult(member.key, member.name, null, false)
        }
        val memberId = (made as Outcome.Success).value.id
        val link = clinic.api.addFamily(mainId, NewFamilyLink(memberId, member.relation.wire, false))
        if (link is Outcome.Failure) log.warn("intake.family_link_failed") { code("error", link.error.code.value) }
        FamilyResult(member.key, member.name, memberId, link is Outcome.Success)
    }

/** Member edits, so the holder keeps one line per setter. */
internal fun List<FamilyMemberForm>.change(
    key: Int,
    edit: FamilyMemberForm.() -> FamilyMemberForm,
): List<FamilyMemberForm> = map { if (it.key == key) it.edit() else it }
