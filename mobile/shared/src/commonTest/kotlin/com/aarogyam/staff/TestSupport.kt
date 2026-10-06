package com.aarogyam.staff

import com.aarogyam.staff.config.AppConfig
import com.aarogyam.staff.config.AppEnvironment
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
        """"refresh_token":"$refresh","user":{"id":"$USER_ID","email":"asha.patil@example.com"}}"""

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
): AppGraph {
    val graph =
        assertIs<AppGraph>(
            AppGraph.create(
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
    graph: AppGraph,
    backend: FakeBackend,
) {
    backend.on("$SUPABASE/auth/v1/verify", { json(sessionJson()) })
    val email = EmailAddress.parse("asha.patil@example.com")
    val code = OneTimeCode.parse("123456")
    check(email != null && code != null)
    assertIs<Outcome.Success<*>>(graph.sessions.verifyEmailCode(email, code))
}

const val ME_TWO_CLINICS =
    """{"clinics":[
      {"org_id":"0192f3a4-0000-7000-8000-000000000001","slug":"sunrise","name":"Sunrise Dental","role_key":"doctor","role_name":"Doctor","host":"sunrise.aarogyam.example"},
      {"org_id":"0192f3a4-0000-7000-8000-000000000002","slug":"lotus","name":"Lotus Clinic","role_key":"owner","role_name":"Owner","host":null}
    ]}"""

fun sessionBody(permissions: List<String> = listOf("appointments.read", "patients.read")): String =
    """{"clinic":{"id":"0192f3a4-0000-7000-8000-000000000001","slug":"sunrise","name":"Sunrise Dental",
       "timezone":"Asia/Kolkata","branding":{"brand":"#0E7490","mode":"dark","logo":"kept"}},
       "membership":{"id":"m1","role_key":"doctor","permissions":${permissions.joinToString(
        ",",
        "[",
        "]",
    ) { "\"$it\"" }}},
       "user":{"id":"$USER_ID","display_name":"Dr. Patil"},"extra_field":true}"""

fun appointment(
    id: String,
    startsAt: String,
    status: String,
    name: String,
    reason: String? = null,
): String =
    """{"id":"$id","branch_id":"b1","starts_at":"$startsAt","ends_at":"$startsAt","status":"$status","kind":"follow_up",
       "has_notes":false,"source":"front_desk","reason":${reason?.let { "\"$it\"" } ?: "null"},"room":"Chair 1",
       "patient":{"id":"p-$id","number":"SC-10$id","full_name":"$name","sex":"female","age_years":34},
       "practitioner":{"id":"d1","display_name":"Dr. Patil","calendar_color":null}}"""

fun todayBody(
    asOf: String = "2026-10-05T04:15:00Z",
    appointments: List<String> =
        listOf(
            appointment("1", "2026-10-05T03:30:00Z", "completed", "Meera Shah", "Root canal review"),
            appointment("2", "2026-10-05T04:45:00Z", "arrived", "Kavya Reddy", "Braces"),
            appointment("3", "2026-10-05T05:15:00Z", "booked", "Rohan Iyer", "Crown fitting"),
            appointment("4", "2026-10-05T05:30:00Z", "cancelled", "Asha Rao"),
        ),
): String =
    """{"date":"2026-10-05","as_of":"$asOf","appointments":${appointments.joinToString(",", "[", "]")},
       "counts":{"total":3,"booked":1,"arrived":1,"in_chair":0,"done":1,"no_shows":0,"cancelled":1,"waiting":2},
       "by_hour":[{"hour":9,"booked":1,"completed":1}],"chairs":[{"room_id":"r1","name":"Chair 1","kind":"chair","status":"free","current":null,"next":null}],
       "recent_patients":[],"team":[],"attention":[]}"""

/** Opens the Sunrise clinic through the fake backend and returns its context. */
suspend fun openClinic(
    backend: FakeBackend,
    graph: AppGraph,
    scope: CoroutineScope,
    permissions: List<String>,
): com.aarogyam.staff.clinic.ClinicContext {
    backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
    backend.on("$SUNRISE/api/v1/session", { json(sessionBody(permissions)) })
    signIn(graph, backend)
    val picker = graph.clinicPicker(scope, autoOpenSingle = false)
    picker.state.first { it is com.aarogyam.staff.clinic.ClinicPickerState.Choose }
    picker.select("sunrise")
    return graph.directory.current
        .filterNotNull()
        .first()
}

fun patientJson(
    id: String,
    name: String,
    number: String = "SD-1042",
    balance: Long? = 125000,
    next: String? = """{"starts_at":"2026-10-12T04:30:00Z","practitioner":"Dr. Patil"}""",
): String =
    """{"id":"$id","number":"$number","full_name":"$name","sex":"female","age_years":34,"birth_date_estimated":false,
       "preferred_language":"en-IN","status":"active","created_at":"2026-01-01T00:00:00Z","recall_due":true,
       "phone":"+91******3210","balance_paise":${balance ?: "null"},"next_appointment":${next ?: "null"}}"""

fun patientListJson(vararg patients: String): String = """{"items":${patients.joinToString(",", "[", "]")}}"""
