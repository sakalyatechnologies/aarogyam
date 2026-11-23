package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.FamilyLink
import com.aarogyam.staff.api.model.FamilyLinkChange
import com.aarogyam.staff.api.model.FamilyList
import com.aarogyam.staff.api.model.NewFamilyLink
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/** `GET /api/v1/patients/{id}/family` (`listFamily`): the patient's relatives, by name. */
suspend fun ClinicApi.family(patientId: String): Outcome<FamilyList, ApiError> =
    client.call { url("api/v1/patients/${patientId.encodeURLPathPart()}/family") }

/**
 * `POST /api/v1/patients/{id}/family` (`addFamilyLink`): links [link] (what the relative is to
 * this patient); the server writes the inverse too. 409 for themselves or a pair already linked.
 */
suspend fun ClinicApi.addFamily(
    patientId: String,
    link: NewFamilyLink,
): Outcome<FamilyLink, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/family")
        contentType(ContentType.Application.Json)
        setBody(link)
    }

/** `DELETE /api/v1/patients/{id}/family/{link_id}` (`removeFamilyLink`): removes the link and its inverse. */
suspend fun ClinicApi.removeFamily(
    patientId: String,
    linkId: String,
): Outcome<Unit, ApiError> =
    client.call {
        method = HttpMethod.Delete
        url("api/v1/patients/${patientId.encodeURLPathPart()}/family/${linkId.encodeURLPathPart()}")
    }

/** Changes a link in place (`PATCH /patients/{id}/family/{link_id}`): the relation, or who is the primary contact. */
suspend fun ClinicApi.changeFamily(
    patientId: String,
    linkId: String,
    change: FamilyLinkChange,
): Outcome<FamilyLink, ApiError> =
    client.call {
        method = HttpMethod.Patch
        url("api/v1/patients/${patientId.encodeURLPathPart()}/family/${linkId.encodeURLPathPart()}")
        contentType(ContentType.Application.Json)
        setBody(change)
    }
