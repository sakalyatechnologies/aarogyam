package com.aarogyam.patient

import com.aarogyam.patient.appointments.AppointmentsState
import com.aarogyam.patient.appointments.CancelError
import com.aarogyam.patient.booking.BookingError
import com.aarogyam.patient.clinics.LinkError
import com.aarogyam.patient.home.HomeState
import com.aarogyam.patient.records.ListState
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PatientStateHoldersTest {
    private val me = "$DEMO_APP/api/v1/me/patient"

    @Test
    fun times_are_read_in_the_clinics_own_offset() {
        val at = ClinicTime.parse("2026-10-12T10:30:00+05:30")
        assertEquals(ClinicTime(LocalDate(2026, 10, 12), LocalTime(10, 30)), at)
        assertNull(ClinicTime.parse("tomorrow"))
        assertNull(ClinicTime.parse(null))
        assertEquals(VisitStatus.AtClinic, VisitStatus.of("in_chair"))
        assertEquals(VisitStatus.Unknown, VisitStatus.of("teleported"))
    }

    @Test
    fun home_is_one_request_for_every_clinic() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$DEMO_APP/api/v1/me/patient/home",
                {
                    json(
                        """{"email":"ravi.kumar@example.com","next_appointment":${visitJson(
                            "a1",
                        )},"balance_paise":125000,
                           "clinics":[{"clinic":${clinicJson()},"next_appointment":${visitJson(
                            "a1",
                        )},"balance_paise":125000,
                           "prescriptions":2,"last_prescription_at":"2026-10-03T11:00:00+05:30"},
                           {"clinic":${clinicJson(
                            LOTUS_ID,
                            "lotus",
                            "Lotus Clinic",
                        )},"next_appointment":null,"balance_paise":0,
                           "prescriptions":1,"last_prescription_at":null}]}""",
                    )
                },
            )
            val graph = signedIn(backend, backgroundScope)
            val holder = graph.home(backgroundScope)
            val view = (holder.state.first { it is HomeState.Loaded } as HomeState.Loaded).view
            assertEquals("a1", view.next?.id)
            assertEquals("Sunrise Dental", view.next?.clinicName)
            assertEquals(LocalTime(10, 30), view.next?.at?.time)
            assertEquals(125000, view.balancePaise)
            assertEquals(3, view.prescriptions)
            assertEquals(listOf("Sunrise Dental", "Lotus Clinic"), view.clinics.map { it.clinic.name })
            assertEquals("#0E7490", view.clinics[0].clinic.brand)
            assertEquals(1, backend.count("$DEMO_APP/api/v1/me/patient/home"))
            // Only the app host was asked: the clinic never comes from the app.
            assertTrue(backend.requests.none { it.url.host.startsWith("sunrise") })
        }

    @Test
    fun home_shows_an_error_it_can_retry() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$DEMO_APP/api/v1/me/patient/home",
                { apiError(HttpStatusCode.InternalServerError, "internal") },
            )
            val graph = signedIn(backend, backgroundScope)
            val failed = graph.home(backgroundScope).state.first { it is HomeState.Failed }
            assertEquals(ScreenError.Server, (failed as HomeState.Failed).error)
        }

    @Test
    fun a_clinic_code_adds_the_clinic() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson())
            val holder = graph.clinics(backgroundScope)
            holder.state.first { !it.loading }
            assertEquals(emptyList(), holder.state.value.clinics)

            holder.onCodeChange("7kq2m")
            holder.submitCode()
            assertEquals(LinkError.InvalidCode, holder.state.value.linkError)

            backend.on("$DEMO_APP/api/v1/me/patient/links", {
                json("""{"clinic_id":"$SUNRISE_ID","outcome":"linked"}""", HttpStatusCode.Created)
            })
            backend.on(me, { json(meJson(clinicJson())) })
            holder.onCodeChange("7kq2m-x9d4t")
            assertEquals("7KQ2M-X9D4T", holder.state.value.code)
            holder.submitCode()
            val added = holder.state.first { it.linked != null }
            assertEquals("Sunrise Dental", added.linked?.name)
            assertEquals(listOf("SD-1042"), added.clinics.map { it.patientNumber })
            assertEquals("", added.code)
            val sent = backend.requests.last { it.url.encodedPath.endsWith("/links") }
            assertEquals(
                """{"code":"7KQ2MX9D4T"}""",
                (sent.body as OutgoingContent.ByteArrayContent).bytes().decodeToString(),
            )
        }

    @Test
    fun a_used_or_taken_code_says_why() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson())
            val holder = graph.clinics(backgroundScope)
            holder.state.first { !it.loading }
            backend.on(
                "$DEMO_APP/api/v1/me/patient/links",
                { apiError(HttpStatusCode.NotFound, "code_not_found") },
                { apiError(HttpStatusCode.Conflict, "record_linked") },
            )
            holder.onCodeChange("7KQ2MX9D4T")
            holder.submitCode()
            assertEquals(LinkError.CodeNotFound, holder.state.first { it.linkError != null }.linkError)
            holder.onCodeChange("7KQ2MX9D4T")
            holder.submitCode()
            assertEquals(LinkError.RecordTaken, holder.state.first { it.linkError != null }.linkError)
        }

    @Test
    fun asking_a_clinic_sends_its_slug_and_never_says_whether_it_knows_you() =
        runTest {
            val backend = FakeBackend()
            val graph = signedIn(backend, backgroundScope, meJson())
            val holder = graph.clinics(backgroundScope)
            holder.state.first { !it.loading }
            holder.submitRequest()
            assertEquals(LinkError.NoClinic, holder.state.value.linkError)
            backend.on("$DEMO_APP/api/v1/me/patient/link-requests", { json("", HttpStatusCode.Accepted) })
            holder.onClinicChange(" Sunrise ")
            holder.submitRequest()
            assertTrue(holder.state.first { it.requested }.requested)
            val sent = backend.requests.last { it.url.encodedPath.endsWith("/link-requests") }
            assertEquals(
                """{"clinic":"sunrise"}""",
                (sent.body as OutgoingContent.ByteArrayContent).bytes().decodeToString(),
            )
        }

    @Test
    fun cancelling_goes_to_the_appointments_own_clinic_host() =
        runTest {
            val backend = FakeBackend()
            val list = "$DEMO_APP/api/v1/me/patient/appointments"
            backend.on(
                list,
                {
                    json(
                        """{"upcoming":[${visitJson("a1")},${visitJson("a2", clinicId = LOTUS_ID)}],
                           "past":[${visitJson("a0", "2026-09-01T09:00:00+05:30", "completed", canCancel = false)}]}""",
                    )
                },
                {
                    json(
                        """{"upcoming":[${visitJson(
                            "a1",
                        )}],"past":[${visitJson("a2", status = "cancelled", canCancel = false)}]}""",
                    )
                },
            )
            backend.on(
                "$LOTUS/api/v1/me/patient/appointments/a2/cancel",
                { json("""{"id":"a2","status":"cancelled"}""") },
            )
            val graph = signedIn(backend, backgroundScope)
            val holder = graph.appointments(backgroundScope)
            val loaded = holder.state.first { it is AppointmentsState.Loaded } as AppointmentsState.Loaded
            assertEquals(listOf("Sunrise Dental", "Lotus Clinic"), loaded.upcoming.map { it.clinicName })
            assertEquals(VisitStatus.Done, loaded.past.single().status)

            holder.cancel("a0")
            assertEquals(
                0,
                backend.requests.count {
                    it.method == HttpMethod.Post &&
                        it.url.encodedPath.endsWith("/cancel")
                },
            )
            holder.cancel("a2")
            val after =
                holder.state.first {
                    it is AppointmentsState.Loaded && it.upcoming.size == 1
                } as AppointmentsState.Loaded
            assertEquals(VisitStatus.Cancelled, after.past.single().status)
            assertEquals(1, backend.count("$LOTUS/api/v1/me/patient/appointments/a2/cancel"))
        }

    @Test
    fun too_late_to_cancel_asks_the_patient_to_call() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$DEMO_APP/api/v1/me/patient/appointments",
                { json("""{"upcoming":[${visitJson("a1")}],"past":[]}""") },
            )
            backend.on(
                "$SUNRISE/api/v1/me/patient/appointments/a1/cancel",
                { apiError(HttpStatusCode.Conflict, "conflict") },
            )
            val graph = signedIn(backend, backgroundScope)
            val holder = graph.appointments(backgroundScope)
            holder.state.first { it is AppointmentsState.Loaded }
            holder.cancel("a1")
            val failed =
                holder.state.first {
                    (it as? AppointmentsState.Loaded)?.cancelError != null
                } as AppointmentsState.Loaded
            assertEquals(CancelError.TooLate, failed.cancelError)
            assertNull(failed.cancelling)
        }

    @Test
    fun booking_walks_doctor_day_and_slot_on_the_clinic_host() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/public/booking",
                {
                    json(
                        """{"clinic_name":"Sunrise Dental","timezone":"Asia/Kolkata","today":"2026-10-07","enabled":true,
                           "slot_minutes":15,"auto_confirm":false,"horizon_days":3,
                           "doctors":[{"id":"d1","name":"Dr Asha Rao","specialty":"Dentist"}]}""",
                    )
                },
            )
            backend.on(
                "$SUNRISE/api/v1/public/availability",
                {
                    json(
                        """{"date":"2026-10-07","practitioner_id":"d1","slot_minutes":15,"slots":["2026-10-07T16:00:00+05:30"]}""",
                    )
                },
            )
            backend.on("$SUNRISE/api/v1/me/patient/bookings", {
                json(visitJson("new", "2026-10-07T16:00:00+05:30", "requested"), HttpStatusCode.Created)
            })
            val graph = signedIn(backend, backgroundScope, meJson(clinicJson()))
            val holder = graph.booking(backgroundScope)
            // One clinic and one doctor are chosen for the patient; the first day's slots load.
            val ready = holder.state.first { it.slots.isNotEmpty() }
            assertEquals("d1", ready.doctorId)
            assertEquals(3, ready.days.size)
            assertEquals(
                LocalTime(16, 0),
                ready.slots
                    .single()
                    .at
                    ?.time,
            )
            val asked = backend.requests.last { it.url.encodedPath.endsWith("/availability") }
            assertEquals("2026-10-07", asked.url.parameters["date"])

            holder.selectSlot("2026-10-07T16:00:00+05:30")
            holder.onReasonChange("Check-up")
            holder.book()
            val booked = holder.state.first { it.booked != null }.booked
            assertEquals(VisitStatus.Requested, booked?.status)
            val body =
                backend.requests
                    .last {
                        it.url.encodedPath.endsWith(
                            "/bookings",
                        )
                    }.body as OutgoingContent.ByteArrayContent
            assertEquals(
                """{"practitioner_id":"d1","starts_at":"2026-10-07T16:00:00+05:30","reason":"Check-up"}""",
                body.bytes().decodeToString(),
            )
        }

    @Test
    fun a_clinic_without_online_booking_says_so() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$SUNRISE/api/v1/public/booking",
                {
                    json(
                        """{"clinic_name":"Sunrise Dental","timezone":"Asia/Kolkata","today":"2026-10-07","enabled":false,
                           "slot_minutes":15,"auto_confirm":false,"horizon_days":30,"doctors":[]}""",
                    )
                },
            )
            val graph = signedIn(backend, backgroundScope, meJson(clinicJson()))
            val holder = graph.booking(backgroundScope)
            assertEquals(BookingError.BookingOff, holder.state.first { it.error != null }.error)
        }

    @Test
    fun prescriptions_and_bills_are_read_only_lists() =
        runTest {
            val backend = FakeBackend()
            backend.on(
                "$DEMO_APP/api/v1/me/patient/prescriptions",
                {
                    json(
                        """{"items":[{"id":"rx1","clinic_id":"$SUNRISE_ID","number":"RX-12","issued_at":"2026-10-03T11:00:00+05:30",
                           "doctor_name":"Dr Asha Rao","diagnosis":null,"advice":"Warm saline rinses","follow_up_on":"2026-10-10",
                           "verify_url":"https://sunrise.aarogyam.example/verify/prescriptions/t",
                           "items":[{"drug_name":"AMOXICILLIN","strength":"500 mg","form":"capsule","dose":"1","frequency":"1-0-1",
                           "timing":"after_food","duration_days":5,"instructions":null}]}]}""",
                    )
                },
            )
            backend.on(
                "$DEMO_APP/api/v1/me/patient/bills",
                {
                    json(
                        """{"balance_paise":60000,"balances":[{"clinic_id":"$SUNRISE_ID","balance_paise":60000}],
                           "items":[{"id":"b1","clinic_id":"$SUNRISE_ID","number":"SD/26-27/000318","issued_at":"2026-10-03T11:00:00+05:30",
                           "total_paise":100000,"paid_paise":40000,"balance_paise":60000,
                           "items":[{"description":"Scaling","quantity":1,"total_paise":100000}]}]}""",
                    )
                },
            )
            val graph = signedIn(backend, backgroundScope)
            val rx = graph.prescriptions(backgroundScope).state.first { it is ListState.Loaded } as ListState.Loaded
            val first = rx.items.single()
            assertEquals("Sunrise Dental", first.clinicName)
            assertEquals("after_food", first.medicines.single().timing)
            assertEquals("https://sunrise.aarogyam.example/verify/prescriptions/t", first.verifyUrl)
            val bills = graph.bills(backgroundScope).state.first { it is ListState.Loaded } as ListState.Loaded
            val view = bills.items.single()
            assertEquals(60000, view.balancePaise)
            assertEquals(
                "Scaling",
                view.bills
                    .single()
                    .lines
                    .single()
                    .label,
            )
            assertIs<ListState.Loaded<*>>(bills)
        }
}
