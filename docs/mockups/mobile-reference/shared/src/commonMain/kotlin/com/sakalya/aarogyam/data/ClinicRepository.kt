package com.sakalya.aarogyam.data

import com.sakalya.aarogyam.model.Alert
import com.sakalya.aarogyam.model.Appointment
import com.sakalya.aarogyam.model.AppointmentId
import com.sakalya.aarogyam.model.AppointmentState
import com.sakalya.aarogyam.model.Bill
import com.sakalya.aarogyam.model.BillState
import com.sakalya.aarogyam.model.FlagKind
import com.sakalya.aarogyam.model.Patient
import com.sakalya.aarogyam.model.PatientDetail
import com.sakalya.aarogyam.model.PatientFlag
import com.sakalya.aarogyam.model.PatientId
import com.sakalya.aarogyam.model.Prescription
import com.sakalya.aarogyam.model.Stat
import com.sakalya.aarogyam.model.TodayDashboard
import com.sakalya.aarogyam.model.ToothFdi
import com.sakalya.aarogyam.model.ToothRecord
import com.sakalya.aarogyam.model.ToothStatus
import com.sakalya.aarogyam.model.ToothTreatment
import com.sakalya.aarogyam.model.VisitNote

/**
 * Single source of truth for clinic data. The real implementation will
 * hit the Axum API with the tenant-scoped session; this fake keeps UI
 * work unblocked and mirrors the HTML mockups 1:1.
 */
interface ClinicRepository {
    fun today(): TodayDashboard
    fun patients(query: String): List<Patient>
    fun patientDetail(id: PatientId): PatientDetail
}

class FakeClinicRepository : ClinicRepository {

    private val meera = Patient(
        id = PatientId("p-meera"),
        name = "Meera Shah",
        fileNo = "SC-1042",
        age = 34,
        sex = "F",
        headline = "Root canal in progress · tooth 46",
        flags = listOf(
            PatientFlag("Penicillin allergy", FlagKind.Alert),
            PatientFlag("Consent ✓", FlagKind.Ok),
            PatientFlag("RCT in progress", FlagKind.Info),
        ),
        avatarColorArgb = 0xFF1B734AL,
        maskedPhone = "+91 98•••••210",
    )

    private val kavya = Patient(
        id = PatientId("p-kavya"),
        name = "Kavya Reddy",
        fileNo = "SC-0871",
        age = 16,
        sex = "F",
        headline = "Orthodontics · braces",
        flags = listOf(
            PatientFlag("₹4,200 due", FlagKind.Warn),
            PatientFlag("Consent ✓", FlagKind.Ok),
        ),
        avatarColorArgb = 0xFFA86E0FL,
        maskedPhone = "+91 98•••••318",
    )

    private val rohan = Patient(
        id = PatientId("p-rohan"),
        name = "Rohan Iyer",
        fileNo = "SC-1560",
        age = 41,
        sex = "M",
        headline = "Crown fitting today · Chair 1",
        flags = listOf(
            PatientFlag("Hypertension", FlagKind.Warn),
            PatientFlag("Lab work ready ✓", FlagKind.Ok),
        ),
        avatarColorArgb = 0xFF136650L,
        maskedPhone = "+91 98•••••442",
    )

    private val allPatients = listOf(meera, kavya, rohan)

    override fun today(): TodayDashboard {
        fun appt(id: String, p: Patient, time: String, title: String, state: AppointmentState) =
            Appointment(
                id = AppointmentId(id),
                patientName = p.name,
                patientInitials = p.name.split(" ").map { it.first() }.joinToString(""),
                avatarColorArgb = p.avatarColorArgb,
                time = time,
                title = title,
                chair = "Chair 1",
                state = state,
            )
        val schedule = listOf(
            appt("a1", meera, "9:00", "Root canal review", AppointmentState.Done),
            appt("a2", kavya, "10:15", "Braces adjustment", AppointmentState.Waiting),
            appt("a3", rohan, "10:45", "Crown fitting", AppointmentState.Next),
        )
        return TodayDashboard(
            greeting = "Good morning, Dr. Patil",
            clinicName = "Smile Catchers",
            dateLabel = "Sat 3 Oct",
            stats = listOf(
                Stat("Visits", "24", "+12%", true),
                Stat("Waiting", "5", "2 urgent", false),
                Stat("Collected", "₹48k", "+8%", true),
            ),
            upNext = schedule[2],
            schedule = schedule,
            alerts = listOf(
                Alert("Allergy flag — Penicillin", "Meera Shah · verify before prescribing", FlagKind.Alert),
                Alert("Lab work delayed", "Crown · Rohan Iyer · 2 days overdue", FlagKind.Warn),
                Alert("2 recalls due", "6-month cleaning · template ready", FlagKind.Warn),
            ),
        )
    }

    override fun patients(query: String): List<Patient> =
        if (query.isBlank()) allPatients
        else allPatients.filter {
            it.name.contains(query, ignoreCase = true) || it.fileNo.contains(query, ignoreCase = true)
        }

    override fun patientDetail(id: PatientId): PatientDetail {
        val patient = allPatients.first { it.id == id }
        return when (id) {
            meera.id -> PatientDetail(
                patient = patient,
                teeth = listOf(
                    ToothRecord(ToothFdi(46), ToothStatus.RootCanal, "Lower right 1st molar", listOf(
                        ToothTreatment("Root canal · sitting 3 (obturation)", "3 Oct 26 · Dr. Patil · ₹8,500"),
                        ToothTreatment("Zirconia crown — planned", "Est. 18 Oct · ₹14,000"),
                        ToothTreatment("Root canal · sittings 1–2", "12–20 Sep 26"),
                    )),
                    ToothRecord(ToothFdi(36), ToothStatus.Treated, "Lower left 1st molar", listOf(
                        ToothTreatment("Composite filling (A2)", "12 Sep 26 · Dr. Patil · ₹2,400"),
                    )),
                    ToothRecord(ToothFdi(11), ToothStatus.Treated, "Upper right central", listOf(
                        ToothTreatment("PFM crown", "2 Aug 26 · Dr. Rao · ₹12,000"),
                    )),
                    ToothRecord(ToothFdi(26), ToothStatus.Watch, "Upper left 1st molar", listOf(
                        ToothTreatment("Early caries — watch", "Flagged 3 Oct · review in 6 mo"),
                    )),
                    ToothRecord(ToothFdi(48), ToothStatus.Planned, "Lower right wisdom", listOf(
                        ToothTreatment("Surgical extraction — planned", "CBCT done 20 Sep · ₹6,000"),
                    )),
                ),
                visits = listOf(
                    VisitNote("3 Oct 26", "RCT sitting 3 — obturation, 46", "Canals obturated, post-op IOPA satisfactory. Pain 2/10."),
                    VisitNote("20 Sep 26", "RCT sitting 2 — BMP, 46", "Biomechanical prep done, medicament placed."),
                    VisitNote("12 Sep 26", "RCT sitting 1 + filling 36", "Access 46; Class II composite on 36."),
                ),
                prescriptions = listOf(
                    Prescription("RX-1042-03", "3 Oct 26", listOf(
                        "Azithromycin 500mg — 1/day × 3d",
                        "Ibuprofen 400mg — as needed",
                        "Chlorhexidine mouthwash 0.2% — 7d",
                    ), allergyCheckPassed = true),
                ),
                bills = listOf(
                    Bill("SC/26-27/000318", "3 Oct 26", 850_00, BillState.Paid),
                    Bill("SC/26-27/000290", "12 Sep 26", 1190_00, BillState.Paid),
                ),
            )
            else -> PatientDetail(
                patient = patient,
                teeth = emptyList(),
                visits = listOf(VisitNote("Today", "Scheduled visit", "See schedule for details.")),
                prescriptions = emptyList(),
                bills = emptyList(),
            )
        }
    }
}
