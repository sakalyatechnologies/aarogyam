package com.aarogyam.patient

import com.aarogyam.patient.config.AppConfig
import com.aarogyam.patient.config.AppEnvironment
import com.sakalya.mobile.auth.EmailAddress
import com.sakalya.mobile.auth.OneTimeCode
import com.sakalya.mobile.core.MemoryLogSink
import com.sakalya.mobile.core.Outcome
import com.sakalya.mobile.securestorage.InMemorySecureStore
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlin.io.encoding.Base64
import kotlin.test.assertIs

const val USER_ID = "0192f3a4-5b6c-7d8e-9f01-23456789abcd"
const val DEMO_APP = "aarogyam-portal.spring-snow-130f.workers.dev"
const val SUNRISE = "sunrise-aarogyam.spring-snow-130f.workers.dev"
const val SUPABASE = "proj.supabase.co"

fun testConfig(environment: AppEnvironment = AppEnvironment.Demo): AppConfig =
    AppConfig(environment, version = "0.1.0", debug = true, supabaseUrl = "https://$SUPABASE", supabaseKey = "pk-test")

/** A JWT-shaped access token for [USER_ID]; the signature is not real. */
fun jwt(marker: String = "a"): String {
    val encoder = Base64.UrlSafe.withPadding(Base64.PaddingOption.ABSENT)
    val header = encoder.encode("""{"alg":"HS256"}""".encodeToByteArray())
    val payload = encoder.encode("""{"sub":"$USER_ID","m":"$marker"}""".encodeToByteArray())
    return "$header.$payload.signature"
}

fun sessionJson(
    access: String = jwt(),
    refresh: String = "r1",
): String =
    """{"access_token":"$access","token_type":"bearer","expires_in":3600,"expires_at":4102444800,""" +
        """"refresh_token":"$refresh","user":{"id":"$USER_ID","email":"ravi.kumar@example.com"}}"""

fun MockRequestHandleScope.json(
    body: String,
    status: HttpStatusCode = HttpStatusCode.OK,
): HttpResponseData = respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

fun MockRequestHandleScope.apiError(
    status: HttpStatusCode,
    code: String,
): HttpResponseData = json("""{"error":{"code":"$code","message":"x"}}""", status)

/** Answers by host and path (`"sunrise-…/api/v1/today"`); records every request. */
class FakeBackend {
    val requests = mutableListOf<HttpRequestData>()
    val routes = mutableMapOf<String, MutableList<MockRequestHandleScope.(HttpRequestData) -> HttpResponseData>>()

    /** Queues answers for [route]; the last one repeats. */
    fun on(
        route: String,
        vararg answers: MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ) {
        routes[route] = answers.toMutableList()
    }

    fun count(route: String): Int = requests.count { "${it.url.host}${it.url.encodedPath}" == route }

    val engine: MockEngine =
        MockEngine { request ->
            requests += request
            val answers = routes["${request.url.host}${request.url.encodedPath}"]
            when {
                answers == null -> apiError(HttpStatusCode.NotFound, "not_found")
                answers.size > 1 -> answers.removeAt(0)(request)
                else -> answers[0](request)
            }
        }
}

/**
 * A graph against [backend] with an empty secure store, its session restored (signed out). Logs
 * go to [logs]: sakalya-mobile 0.1.0's iOS `platformLogSink` crashes (variadic `NSLog`).
 */
suspend fun testGraph(
    backend: FakeBackend,
    scope: CoroutineScope,
    environment: AppEnvironment = AppEnvironment.Demo,
    logs: MemoryLogSink = MemoryLogSink(),
): PatientGraph {
    val graph =
        assertIs<PatientGraph>(
            PatientGraph.create(
                testConfig(environment),
                InMemorySecureStore(),
                scope,
                engine = backend.engine,
                logSink = logs,
            ),
        )
    graph.sessions.state.first { it !is com.sakalya.mobile.auth.SessionState.Restoring }
    return graph
}

/** Signs [graph] in through the fake Supabase. */
suspend fun signIn(
    graph: PatientGraph,
    backend: FakeBackend,
) {
    backend.on("$SUPABASE/auth/v1/verify", { json(sessionJson()) })
    val email = EmailAddress.parse("ravi.kumar@example.com")
    val code = OneTimeCode.parse("123456")
    check(email != null && code != null)
    assertIs<Outcome.Success<*>>(graph.sessions.verifyEmailCode(email, code))
}

const val SUNRISE_ID = "0192f3a4-0000-7000-8000-000000000001"
const val LOTUS_ID = "0192f3a4-0000-7000-8000-000000000002"
const val LOTUS = "lotus-aarogyam.spring-snow-130f.workers.dev"

fun clinicJson(
    id: String = SUNRISE_ID,
    slug: String = "sunrise",
    name: String = "Sunrise Dental",
    number: String = "SD-1042",
): String =
    """{"link_id":"l-$slug","clinic_id":"$id","slug":"$slug","name":"$name","host":"$slug.aarogyam.example",
       "timezone":"Asia/Kolkata","branding":{"brand":"#0E7490"},"patient_number":"$number","linked_at":"2026-10-01T10:00:00+05:30"}"""

fun meJson(vararg clinics: String): String =
    """{"email":"ravi.kumar@example.com","clinics":${clinics.joinToString(",", "[", "]")}}"""

fun visitJson(
    id: String,
    startsAt: String = "2026-10-12T10:30:00+05:30",
    status: String = "confirmed",
    clinicId: String = SUNRISE_ID,
    canCancel: Boolean = true,
): String =
    """{"id":"$id","clinic_id":"$clinicId","starts_at":"$startsAt","ends_at":"$startsAt","status":"$status","reason":null,
       "practitioner_id":"d1","doctor_name":"Dr Asha Rao","specialty":"Dentist","can_cancel":$canCancel}"""

/** Signs in and loads the linked clinics through the fake backend. */
suspend fun signedIn(
    backend: FakeBackend,
    scope: CoroutineScope,
    me: String = meJson(clinicJson(), clinicJson(LOTUS_ID, "lotus", "Lotus Clinic", "LC-7")),
): PatientGraph {
    backend.on("$DEMO_APP/api/v1/me/patient", { json(me) })
    val graph = testGraph(backend, scope)
    signIn(graph, backend)
    graph.directory.load(refresh = true)
    return graph
}
