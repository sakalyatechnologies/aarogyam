package com.aarogyam.patient

import com.aarogyam.patient.api.PatientAppApi
import com.aarogyam.patient.api.PatientClinicApi
import com.aarogyam.patient.api.model.PatientClinic
import com.aarogyam.patient.api.model.PatientMe
import com.aarogyam.patient.config.Hosts
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.BaseUrl
import io.ktor.client.HttpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The patient's linked clinics, cached from `GET /me/patient` until a link changes or sign-out,
 * and the API for the app host and for each clinic's own host.
 */
class PatientDirectory(
    private val hosts: Hosts,
    private val clientFor: (BaseUrl) -> HttpClient,
    private val log: Logger = Logger("aarogyam.patient.clinics"),
) {
    private val mutableMe = MutableStateFlow<PatientMe?>(null)

    /** The account and its clinics, once loaded. */
    val me: StateFlow<PatientMe?> = mutableMe.asStateFlow()

    /** The app host's API, or a `not_configured` failure for a build without one. */
    fun app(): Outcome<PatientAppApi, ApiError> =
        hosts.app()?.let { Outcome.Success(PatientAppApi(clientFor(it))) }
            ?: Outcome.Failure(ScreenError.notConfigured())

    /** The API on [clinic]'s own host, or null when the build can't reach it. */
    fun clinicApi(clinic: PatientClinic): PatientClinicApi? =
        hosts.clinic(clinic.slug, clinic.host)?.let { PatientClinicApi(clientFor(it)) }

    /** The linked clinic with [clinicId], from the cache. */
    fun clinic(clinicId: String): PatientClinic? = mutableMe.value?.clinics?.firstOrNull { it.clinicId == clinicId }

    /** The account and its clinics, from the cache unless [refresh]. */
    suspend fun load(refresh: Boolean = false): Outcome<PatientMe, ApiError> {
        mutableMe.value?.takeUnless { refresh }?.let { return Outcome.Success(it) }
        val api =
            when (val found = app()) {
                is Outcome.Success -> found.value
                is Outcome.Failure -> return found
            }
        return when (val loaded = api.me()) {
            is Outcome.Success -> {
                loaded.also { mutableMe.value = it.value }
            }

            is Outcome.Failure -> {
                loaded.also {
                    log.warn(
                        "patient.clinics_failed",
                    ) { code("error", it.error.code.value) }
                }
            }
        }
    }

    /** Forgets everything, at sign-out. */
    fun clear() {
        mutableMe.value = null
    }
}
