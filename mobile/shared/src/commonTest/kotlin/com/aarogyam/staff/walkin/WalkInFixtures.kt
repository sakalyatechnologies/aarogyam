package com.aarogyam.staff.walkin

import com.aarogyam.staff.SUNRISE

const val LOOKUP = "$SUNRISE/api/v1/patients/lookup"
const val WALK_INS = "$SUNRISE/api/v1/walk-ins"
const val DOCTORS = "$SUNRISE/api/v1/practitioners"
const val PICKS = "$SUNRISE/api/v1/quick-picks"

val DESK = listOf("patients.read", "patients.write", "appointments.write", "intake.write")

const val DOCTORS_JSON =
    """{"items":[{"id":"d1","display_name":"Dr. Patil","calendar_color":"#0E7490","active":true},
       {"id":"d2","display_name":"Dr. Gone","calendar_color":"#7C3AED","active":false}]}"""

const val PICKS_JSON =
    """{"allergies":[{"id":"penicillin","label":"Penicillin"},{"id":"latex","label":"Latex"}],
       "complaints":[],"findings":[],"procedures":[],"advice":[],"medicine_sets":[]}"""

const val MATCHES_JSON =
    """{"items":[{"id":"p1","number":"SD-1042","full_name":"Meera Shah","sex":"female","age_years":34}]}"""

fun tokenJson(
    id: String = "t1",
    number: Int = 7,
    status: String = "waiting",
    patientId: String = "p1",
    name: String = "Meera Shah",
): String =
    """{"id":"$id","branch_id":"b1","day":"2026-10-08","token_number":$number,"status":"$status",
       "issued_at":"2026-10-08T04:00:00Z","wait_minutes":12,
       "patient":{"id":"$patientId","number":"SD-1042","full_name":"$name","sex":"female","age_years":34},
       "practitioner":{"id":"d1","display_name":"Dr. Patil","calendar_color":null}}"""

fun walkInJson(registered: Boolean = true): String =
    """{"patient":{"id":"p9","number":"SD-1050","full_name":"Ravi Kulkarni","sex":"male","age_years":40,
       "birth_date_estimated":true,"preferred_language":"en-IN","status":"active","created_at":"2026-10-08T04:00:00Z",
       "recall_due":false,"row_version":1},"registered":$registered,"token":${tokenJson(
        patientId = "p9",
        name = "Ravi Kulkarni",
    )},
       "allergies_recorded":1,"consents_recorded":["care","reminders"]}"""
