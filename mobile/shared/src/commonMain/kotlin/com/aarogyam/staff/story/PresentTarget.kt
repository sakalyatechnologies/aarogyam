package com.aarogyam.staff.story

import com.aarogyam.staff.patients.VisitView

/** Show patient opens on the patient's open visit, else the newest one; null when there is none. */
fun showPatientVisit(visits: List<VisitView>?): String? =
    visits?.firstOrNull { it.open }?.id ?: visits?.firstOrNull()?.id
