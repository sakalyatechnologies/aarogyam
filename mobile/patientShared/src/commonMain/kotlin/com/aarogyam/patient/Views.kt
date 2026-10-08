package com.aarogyam.patient

import com.aarogyam.patient.api.model.PatientAppointment
import com.aarogyam.patient.api.model.PatientClinic
import kotlinx.datetime.LocalDate
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * A time as its clinic shows it. The API sends RFC 3339 in the clinic's own offset, so the date
 * and time are read as written, never converted to the phone's zone.
 */
data class ClinicTime(
    val date: LocalDate,
    val time: LocalTime,
) {
    companion object {
        /** Reads `2026-10-08T10:30:00+05:30`; null for anything else. */
        fun parse(text: String?): ClinicTime? {
            if (text == null || text.length < LOCAL_PART) return null
            val local = runCatching { LocalDateTime.parse(text.take(LOCAL_PART)) }.getOrNull() ?: return null
            return ClinicTime(local.date, local.time)
        }

        private const val LOCAL_PART = 19
    }
}

/** Where an appointment stands, for the chip and copy each platform draws. */
enum class VisitStatus {
    Requested,
    Booked,
    Confirmed,
    AtClinic,
    Done,
    Cancelled,
    Missed,
    Unknown,
    ;

    companion object {
        fun of(text: String): VisitStatus =
            when (text) {
                "requested" -> Requested
                "booked" -> Booked
                "confirmed" -> Confirmed
                "arrived", "in_chair" -> AtClinic
                "completed" -> Done
                "cancelled" -> Cancelled
                "no_show" -> Missed
                else -> Unknown
            }
    }
}

/** An appointment, ready to draw. */
data class AppointmentView(
    val id: String,
    val clinicId: String,
    val clinicName: String,
    val doctorName: String,
    val specialty: String?,
    val at: ClinicTime?,
    val status: VisitStatus,
    val canCancel: Boolean,
)

/** A linked clinic, ready to draw; [brand] is its `#rrggbb` colour, if set. */
data class ClinicView(
    val id: String,
    val name: String,
    val slug: String,
    val patientNumber: String,
    val brand: String?,
)

internal fun PatientClinic.view(): ClinicView =
    ClinicView(
        id = clinicId,
        name = name,
        slug = slug,
        patientNumber = patientNumber,
        brand = (branding["brand"] as? JsonPrimitive)?.contentOrNull,
    )

internal fun PatientAppointment.view(clinicName: (String) -> String): AppointmentView =
    AppointmentView(
        id = id,
        clinicId = clinicId,
        clinicName = clinicName(clinicId),
        doctorName = doctorName,
        specialty = specialty,
        at = ClinicTime.parse(startsAt),
        status = VisitStatus.of(status),
        canCancel = canCancel,
    )
