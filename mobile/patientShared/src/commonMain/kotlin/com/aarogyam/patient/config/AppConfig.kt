package com.aarogyam.patient.config

import com.sakalya.mobile.http.BaseUrl

/** Where the app's API calls go. */
enum class AppEnvironment {
    /** The Vite dev server on this machine (`adb reverse tcp:5173 tcp:5173` on Android). */
    Local,

    /** The workers.dev demo deployment. */
    Demo,

    /** The product domain. */
    Prod,
}

/** Build-time settings, supplied by each platform's build (Android `BuildConfig`). */
data class AppConfig(
    val environment: AppEnvironment,
    val version: String,
    val debug: Boolean,
    val supabaseUrl: String,
    val supabaseKey: String,
    /** The product's app host for [AppEnvironment.Prod]; empty until the domain is chosen. */
    val prodAppHost: String = "",
)

/**
 * Host names per environment. The clinic is chosen by host only (product rule 1): the app host
 * answers `/me`, each clinic's host answers everything about that clinic.
 */
class Hosts(
    private val config: AppConfig,
) {
    /** The app host, or null when this build has none configured. */
    fun app(): BaseUrl? =
        when (config.environment) {
            AppEnvironment.Local -> local("app")
            AppEnvironment.Demo -> BaseUrl.https(DEMO_APP_HOST)
            AppEnvironment.Prod -> config.prodAppHost.takeIf { it.isNotBlank() }?.let(BaseUrl::https)
        }

    /** The host of the clinic with [slug] (and [host] as the API reports it), or null if invalid. */
    fun clinic(
        slug: String,
        host: String?,
    ): BaseUrl? =
        when (config.environment) {
            AppEnvironment.Local -> local(slug)
            AppEnvironment.Demo -> BaseUrl.https("$slug$DEMO_CLINIC_SUFFIX")
            AppEnvironment.Prod -> host?.let(BaseUrl::https)
        }

    // Cleartext only in debug builds; release builds of the local flavour cannot reach it.
    private fun local(subdomain: String): BaseUrl? =
        BaseUrl.parse("http://$subdomain.localtest.me:5173", allowCleartext = config.debug)

    private companion object {
        const val DEMO_APP_HOST = "aarogyam-portal.spring-snow-130f.workers.dev"
        const val DEMO_CLINIC_SUFFIX = "-aarogyam.spring-snow-130f.workers.dev"
    }
}
