package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.AllergyCheck
import com.aarogyam.staff.api.model.AllergyCheckItem
import com.aarogyam.staff.api.model.AllergyCheckRequest
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType
import io.ktor.http.encodeURLPathPart

/**
 * `POST /api/v1/patients/{id}/allergy-check` (`checkAllergies`, prescriptions.issue): the clinic's
 * allergy check on the lines being written, before Issue. Writes nothing; Issue checks again. The
 * names travel in the body, never the URL.
 */
suspend fun ClinicApi.checkAllergies(
    patientId: String,
    items: List<AllergyCheckItem>,
): Outcome<AllergyCheck, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients/${patientId.encodeURLPathPart()}/allergy-check")
        contentType(ContentType.Application.Json)
        setBody(AllergyCheckRequest(items = items))
    }
