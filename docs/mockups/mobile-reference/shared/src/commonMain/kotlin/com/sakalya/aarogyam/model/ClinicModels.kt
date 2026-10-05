package com.sakalya.aarogyam.model

enum class FlagKind { Alert, Ok, Warn, Info }

data class PatientFlag(val text: String, val kind: FlagKind)

data class Patient(
    val id: PatientId,
    val name: String,
    val fileNo: String,
    val age: Int,
    val sex: String,
    /** One-line clinical headline, e.g. "Root canal in progress · tooth 46". */
    val headline: String,
    val flags: List<PatientFlag>,
    /** Avatar background as ARGB Long, e.g. 0xFF1B734A. */
    val avatarColorArgb: Long,
    val maskedPhone: String,
)

enum class ToothStatus { Healthy, Treated, RootCanal, Planned, Watch }

data class ToothTreatment(val title: String, val detail: String)

data class ToothRecord(
    val fdi: ToothFdi,
    val status: ToothStatus,
    val displayName: String,
    val treatments: List<ToothTreatment>,
)

data class VisitNote(val date: String, val title: String, val body: String)

data class Prescription(
    val id: String,
    val date: String,
    val items: List<String>,
    /** True when the allergy/interaction check passed at issue time. */
    val allergyCheckPassed: Boolean,
)

data class Bill(val id: String, val date: String, val amountPaise: Long, val state: BillState)

enum class BillState { Paid, Due, Partial }

data class PatientDetail(
    val patient: Patient,
    val teeth: List<ToothRecord>,
    val visits: List<VisitNote>,
    val prescriptions: List<Prescription>,
    val bills: List<Bill>,
)

enum class AppointmentState { Done, Waiting, Next, Booked }

data class Appointment(
    val id: AppointmentId,
    val patientName: String,
    val patientInitials: String,
    val avatarColorArgb: Long,
    val time: String,
    val title: String,
    val chair: String,
    val state: AppointmentState,
)

data class Stat(val label: String, val value: String, val delta: String, val positive: Boolean)

data class Alert(val title: String, val detail: String, val severity: FlagKind)

data class TodayDashboard(
    val greeting: String,
    val clinicName: String,
    val dateLabel: String,
    val stats: List<Stat>,
    val upNext: Appointment,
    val schedule: List<Appointment>,
    val alerts: List<Alert>,
)
