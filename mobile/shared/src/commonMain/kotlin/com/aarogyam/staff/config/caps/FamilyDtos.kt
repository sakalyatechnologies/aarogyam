package com.aarogyam.staff.config.caps

import com.aarogyam.staff.api.model.PhoneMatch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** `GET /patients/{id}/family` item: [id] is the link, [patientId] the relative. */
@Serializable
data class FamilyLink(
    val id: String,
    @SerialName("patient_id") val patientId: String,
    val number: String,
    @SerialName("full_name") val fullName: String,
    val relation: String,
    @SerialName("is_primary_contact") val isPrimaryContact: Boolean = false,
)

@Serializable
data class FamilyList(
    val items: List<FamilyLink>,
)

/** `POST /patients/{id}/family` body. */
@Serializable
data class NewFamilyLink(
    @SerialName("related_patient_id") val relatedPatientId: String,
    val relation: String,
    @SerialName("is_primary_contact") val isPrimaryContact: Boolean? = null,
)

/** One `family_group` row of the phone lookup: a relative of [ofPatientId]. */
@Serializable
data class FamilyMember(
    @SerialName("of_patient_id") val ofPatientId: String,
    val id: String,
    val number: String,
    @SerialName("full_name") val fullName: String,
    val relation: String,
)

/** The phone lookup answer as the phone reads it: main's `items`, plus `family_group` once the server sends it. */
@Serializable
data class PhoneMatchesFamily(
    val items: List<PhoneMatch>,
    @SerialName("family_group") val familyGroup: List<FamilyMember>? = null,
)

/** `family_of` of a walk-in request, sent only while [ServerCaps.family] is on. */
@Serializable
data class FamilyOfBody(
    @SerialName("patient_id") val patientId: String,
    val relation: String,
)
