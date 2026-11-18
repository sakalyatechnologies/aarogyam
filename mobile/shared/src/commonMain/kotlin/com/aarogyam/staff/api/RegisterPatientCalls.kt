package com.aarogyam.staff.api

import com.aarogyam.staff.api.model.NewPatient
import com.aarogyam.staff.api.model.Patient
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.call
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.contentType

/** `POST /api/v1/patients` (`registerPatient`): a new patient; needs `patients.write`. No retry key, so call it once. */
suspend fun ClinicApi.registerPatient(body: NewPatient): Outcome<Patient, ApiError> =
    client.call {
        method = HttpMethod.Post
        url("api/v1/patients")
        contentType(ContentType.Application.Json)
        setBody(body)
    }
