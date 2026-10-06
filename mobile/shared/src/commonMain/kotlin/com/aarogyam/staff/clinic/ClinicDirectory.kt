package com.aarogyam.staff.clinic

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.api.AppApi
import com.aarogyam.staff.api.ClinicApi
import com.aarogyam.staff.api.model.MyClinic
import com.aarogyam.staff.api.model.Session
import com.aarogyam.staff.config.Hosts
import com.sakalya.mobile.core.ApiError
import com.sakalya.mobile.core.Logger
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.http.BaseUrl
import io.ktor.client.HttpClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.datetime.TimeZone

/** An open clinic: its host, API, session and how to draw it. Reused until sign-out. */
class ClinicContext(
    val slug: String,
    val api: ClinicApi,
    val session: Session,
) {
    /** The brand colour and mode from the session. */
    val branding: ClinicBranding = ClinicBranding.of(session.clinic)

    /** The clinic's time zone; times are never shown in the phone's. */
    val timeZone: TimeZone = runCatching { TimeZone.of(session.clinic.timezone) }.getOrDefault(TimeZone.UTC)

    /** Permission keys the role holds; anything missing is denied. */
    val permissions: Set<String> = session.membership.permissions.toSet()

    /** Doctors and rooms, fetched once per clinic and reused by every screen. */
    val reference: ReferenceData = ReferenceData(api)
}

/**
 * The person's clinics and the open one. Caches `/me` and each clinic's `/session`, so moving
 * between screens never refetches reference data; [clear] drops everything at sign-out.
 */
class ClinicDirectory(
    private val hosts: Hosts,
    private val clientFor: (BaseUrl) -> HttpClient,
    private val log: Logger = Logger("aarogyam.clinics"),
) {
    private var clinics: List<MyClinic>? = null
    private val contexts = mutableMapOf<String, ClinicContext>()
    private val mutableCurrent = MutableStateFlow<ClinicContext?>(null)

    /** The clinic the person is working in, or null while choosing. */
    val current: StateFlow<ClinicContext?> = mutableCurrent.asStateFlow()

    /** The person's clinics, from the cache unless [refresh]. */
    suspend fun clinics(refresh: Boolean = false): Outcome<List<MyClinic>, ApiError> {
        clinics?.takeUnless { refresh }?.let { return Outcome.Success(it) }
        val app = hosts.app() ?: return Outcome.Failure(ScreenError.notConfigured())
        return when (val me = AppApi(clientFor(app)).me()) {
            is Outcome.Success -> Outcome.Success(me.value.clinics.also { clinics = it })
            is Outcome.Failure -> me.also { log.warn("clinics.load_failed") { code("error", it.error.code.value) } }
        }
    }

    /** Opens [clinic]: loads its session once, then makes it [current]. */
    suspend fun open(clinic: MyClinic): Outcome<ClinicContext, ApiError> {
        val cached = contexts[clinic.slug]
        if (cached != null) {
            mutableCurrent.value = cached
            return Outcome.Success(cached)
        }
        val base = hosts.clinic(clinic.slug, clinic.host) ?: return Outcome.Failure(ScreenError.notConfigured())
        val api = ClinicApi(clientFor(base))
        return when (val session = api.session()) {
            is Outcome.Success -> {
                val context = ClinicContext(clinic.slug, api, session.value)
                contexts[clinic.slug] = context
                mutableCurrent.value = context
                log.info("clinic.opened") { id("org", clinic.orgId) }
                Outcome.Success(context)
            }

            is Outcome.Failure -> {
                session.also { log.warn("clinic.open_failed") { code("error", it.error.code.value) } }
            }
        }
    }

    /** Leaves the open clinic and returns to the picker, keeping the caches. */
    fun leave() {
        mutableCurrent.value = null
    }

    /** Forgets every clinic (sign-out). */
    fun clear() {
        clinics = null
        contexts.clear()
        mutableCurrent.value = null
    }
}
