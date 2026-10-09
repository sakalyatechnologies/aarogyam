package com.aarogyam.staff.today

import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.DEMO_APP
import com.aarogyam.staff.FakeBackend
import com.aarogyam.staff.ME_TWO_CLINICS
import com.aarogyam.staff.SUNRISE
import com.aarogyam.staff.SUPABASE
import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.apiError
import com.aarogyam.staff.appointment
import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.clinic.ClinicPickerState
import com.aarogyam.staff.json
import com.aarogyam.staff.jwt
import com.aarogyam.staff.sessionBody
import com.aarogyam.staff.sessionJson
import com.aarogyam.staff.signIn
import com.aarogyam.staff.testGraph
import com.aarogyam.staff.todayBody
import com.sakalya.mobile.core.MemoryLogSink
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TodayStateHolderTest {
    private suspend fun open(
        backend: FakeBackend,
        scope: CoroutineScope,
        background: CoroutineScope,
        permissions: List<String> = listOf("appointments.read"),
        logs: MemoryLogSink = MemoryLogSink(),
    ): Pair<AppGraph, ClinicContext> {
        backend.on("$DEMO_APP/api/v1/me", { json(ME_TWO_CLINICS) })
        backend.on("$SUNRISE/api/v1/session", { json(sessionBody(permissions)) })
        val graph = testGraph(backend, background, logs = logs)
        signIn(graph, backend)
        val picker = graph.clinicPicker(scope, autoOpenSingle = false)
        picker.state.first { it is ClinicPickerState.Choose }
        picker.select("sunrise")
        return graph to
            graph.directory.current
                .filterNotNull()
                .first()
    }

    @Test
    fun one_request_builds_the_day_in_the_clinic_time_zone() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val holder = graph.today(clinic, this)

            val view = (holder.state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(1, backend.count("$SUNRISE/api/v1/today"))
            assertEquals("Sunrise Dental", view.clinicName)
            assertEquals("Dr. Patil", view.memberName)
            assertEquals(DayPart.Morning, view.dayPart) // 04:15 UTC is 09:45 in Kolkata
            assertEquals(TodayCountsView(visits = 3, waiting = 2, done = 1), view.counts)
            assertEquals(listOf("Meera Shah", "Kavya Reddy", "Rohan Iyer"), view.schedule.map { it.patientName })
            assertEquals(LocalTime(9, 0), view.schedule[0].starts)
            assertEquals(HeroKind.UpNext, view.heroKind)
            assertEquals("Kavya Reddy", view.hero?.patientName)
            assertEquals(VisitStatus.Arrived, view.hero?.status)
        }

    @Test
    fun the_patient_in_the_chair_is_the_hero() =
        runTest {
            val backend = FakeBackend()
            val body =
                todayBody(
                    appointments =
                        listOf(
                            com.aarogyam.staff.appointment("1", "2026-10-05T04:45:00Z", "booked", "Kavya Reddy"),
                            com.aarogyam.staff.appointment("2", "2026-10-05T05:15:00Z", "in_chair", "Rohan Iyer"),
                        ),
                )
            backend.on("$SUNRISE/api/v1/today", { json(body) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val view = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(HeroKind.Now, view.heroKind)
            assertEquals("Rohan Iyer", view.hero?.patientName)
        }

    @Test
    fun without_appointments_read_nothing_is_requested() =
        runTest {
            val backend = FakeBackend()
            val (graph, clinic) = open(backend, this, backgroundScope, permissions = listOf("patients.read"))
            val holder = graph.today(clinic, this)
            assertEquals(TodayState.NotAllowed, holder.state.value)
            holder.refresh()
            assertEquals(0, backend.count("$SUNRISE/api/v1/today"))
        }

    @Test
    fun a_failed_refresh_keeps_the_day_on_screen() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/today",
                { json(todayBody()) },
                { apiError(HttpStatusCode.Forbidden, "forbidden") },
            )
            val (graph, clinic) = open(backend, this, backgroundScope)
            val holder = graph.today(clinic, this)
            holder.state.first { it is TodayState.Loaded }
            holder.refresh()
            val state = holder.state.first { it is TodayState.Loaded && it.error != null } as TodayState.Loaded
            assertEquals(ScreenError.NotAllowed, state.error)
            assertEquals(3, state.view.schedule.size)
        }

    @Test
    fun an_expired_token_is_refreshed_once_and_the_request_retried() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/today",
                { apiError(HttpStatusCode.Unauthorized, "unauthenticated") },
                { json(todayBody()) },
            )
            backend.on("$SUPABASE/auth/v1/token", { json(sessionJson(access = jwt("b"), refresh = "r2")) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val holder = graph.today(clinic, this)
            holder.state.first { it is TodayState.Loaded }
            assertEquals(1, backend.count("$SUPABASE/auth/v1/token"))
            val retried = backend.requests.filter { it.url.encodedPath == "/api/v1/today" }
            assertEquals(2, retried.size)
            assertTrue(retried[0].headers["Authorization"] != retried[1].headers["Authorization"])
        }

    @Test
    fun patient_details_never_reach_the_logs() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/today",
                { json(todayBody()) },
                { apiError(HttpStatusCode.NotImplemented, "internal") },
            )
            val logs = MemoryLogSink()
            val (graph, clinic) = open(backend, this, backgroundScope, logs = logs)
            val holder = graph.today(clinic, this)
            holder.state.first { it is TodayState.Loaded }
            holder.refresh()
            holder.state.first { it is TodayState.Loaded && it.error != null }
            val text = logs.records.joinToString("\n") { it.format() }
            assertTrue(text.contains("today.load_failed"))
            listOf("Kavya Reddy", "SC-102", "Braces", "asha.patil", "Dr. Patil").forEach { assertTrue(it !in text, it) }
        }

    @Test
    fun a_failed_first_load_shows_the_error() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { apiError(HttpStatusCode.NotImplemented, "internal") })
            val (graph, clinic) = open(backend, this, backgroundScope)
            assertEquals(
                TodayState.Failed(ScreenError.Server),
                graph.today(clinic, this).state.first { it is TodayState.Failed },
            )
        }

    private val money =
        """{"date":"2026-10-05","collected_paise":4820000,"payments_today":9,"invoiced_paise":5100000,"invoices_today":8,
           "collected_this_month_paise":90000000,"upi_share_bps":6800,"pending_dues_paise":1250000,"pending_dues_patients":4,
           "revenue_mix":[{"category":"Consultation","amount_paise":30000000,"share_bps":3300},
             {"category":"Treatment","amount_paise":60000000,"share_bps":6700}],"pending":[]}"""

    private fun expense(
        id: String,
        paise: Long,
        status: String,
    ) = """{"id":"$id","category":"lab","category_name":"Lab","spent_on":"2026-10-05","amount_paise":$paise,
           "status":"$status","recorded_by":"m1","created_at":"2026-10-05T04:00:00Z"}"""

    private val expenses = """{"items":[${expense("e1", 150000, "recorded")},${expense("e2", 99000, "void")}]}"""

    @Test
    fun finance_view_adds_the_money_tiles_from_one_extra_request() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            backend.on("$SUNRISE/api/v1/today/money", { json(money) })
            backend.on("$SUNRISE/api/v1/expenses", { json(expenses) })
            val (graph, clinic) = open(backend, this, backgroundScope, listOf("appointments.read", "finance.view"))
            val view = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(1, backend.count("$SUNRISE/api/v1/today/money"))
            assertEquals(1, backend.count("$SUNRISE/api/v1/expenses"))
            assertEquals(
                MoneyView(
                    4820000,
                    9,
                    1250000,
                    4,
                    6800,
                    collectedThisMonthPaise = 90000000,
                    mix = listOf(MixShare("Treatment", 60000000, 6700), MixShare("Consultation", 30000000, 3300)),
                    expensesTodayPaise = 150000,
                ),
                view.money,
            )
        }

    @Test
    fun without_finance_view_money_is_never_requested() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            backend.on("$SUNRISE/api/v1/today/money", { json(money) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val view = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(0, backend.count("$SUNRISE/api/v1/today/money"))
            assertEquals(null, view.money)
        }

    @Test
    fun a_failed_money_request_only_hides_the_tiles() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            backend.on("$SUNRISE/api/v1/today/money", { apiError(HttpStatusCode.Forbidden, "forbidden") })
            val (graph, clinic) = open(backend, this, backgroundScope, listOf("appointments.read", "finance.view"))
            val view = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            assertEquals(null, view.money)
            assertEquals(3, view.counts.visits)
        }

    @Test
    fun a_finance_only_role_gets_money_without_the_day() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today/money", { json(money) })
            backend.on("$SUNRISE/api/v1/expenses", { json(expenses) })
            val (graph, clinic) = open(backend, this, backgroundScope, listOf("finance.view", "patients.read"))
            val state = graph.today(clinic, this).state.first { it is TodayState.MoneyOnly } as TodayState.MoneyOnly
            assertEquals(0, backend.count("$SUNRISE/api/v1/today"))
            assertEquals(4820000, state.money.collectedPaise)
            assertEquals(150000, state.money.expensesTodayPaise)
        }

    @Test
    fun failed_expenses_only_blank_their_tile() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today/money", { json(money) })
            backend.on("$SUNRISE/api/v1/expenses", { apiError(HttpStatusCode.InternalServerError, "internal") })
            val (graph, clinic) = open(backend, this, backgroundScope, listOf("finance.view"))
            val state = graph.today(clinic, this).state.first { it is TodayState.MoneyOnly } as TodayState.MoneyOnly
            assertEquals(null, state.money.expensesTodayPaise)
        }

    @Test
    fun the_me_card_holds_my_own_appointments_and_shift() =
        runTest {
            val backend = FakeBackend()
            val other =
                appointment(
                    "5",
                    "2026-10-05T06:00:00Z",
                    "booked",
                    "Ira Sen",
                    "Scaling",
                ).replace("\"d1\"", "\"d2\"")
            val day =
                todayBody(
                    appointments =
                        listOf(
                            appointment("1", "2026-10-05T03:30:00Z", "completed", "Meera Shah", "Root canal review"),
                            appointment("2", "2026-10-05T04:45:00Z", "arrived", "Kavya Reddy", "Braces"),
                            appointment("3", "2026-10-05T05:15:00Z", "booked", "Rohan Iyer", "Braces"),
                            other,
                        ),
                ).replace(
                    "\"team\":[]",
                    """"team":[{"member_id":"m1","practitioner":{"id":"d1","display_name":"Dr. Patil","calendar_color":null},
                       "shifts":[{"starts":"09:00","ends":"13:00"},{"starts":"16:00","ends":"20:00"}],"on_leave":false,
                       "appointments":3,"specialty":null}]""",
                )
            backend.on("$SUNRISE/api/v1/today", { json(day) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val view = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view
            val me = view.me
            assertEquals("d1", me?.practitionerId)
            assertEquals("doctor", me?.roleKey)
            assertEquals(listOf("Meera Shah", "Kavya Reddy", "Rohan Iyer"), me?.mine?.map { it.patientName })
            assertEquals(2, me?.remaining)
            assertEquals(listOf("Braces"), me?.treatments)
            assertEquals(
                listOf(ShiftView(LocalTime(9, 0), LocalTime(13, 0)), ShiftView(LocalTime(16, 0), LocalTime(20, 0))),
                me?.shifts,
            )
            assertEquals(1f / 3, view.progress)
        }

    @Test
    fun a_member_without_a_doctor_profile_has_no_schedule_of_their_own() =
        runTest {
            val backend = FakeBackend()
            backend.on("$SUNRISE/api/v1/today", { json(todayBody()) })
            val (graph, clinic) = open(backend, this, backgroundScope)
            val me = (graph.today(clinic, this).state.first { it is TodayState.Loaded } as TodayState.Loaded).view.me
            assertEquals(null, me?.practitionerId)
            assertEquals(emptyList(), me?.mine)
        }
}
