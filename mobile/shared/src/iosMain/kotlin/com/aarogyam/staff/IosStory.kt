package com.aarogyam.staff

import com.aarogyam.staff.clinic.ClinicContext
import com.aarogyam.staff.story.PresentStateHolder

/** Show patient on [visitId], living as long as the SwiftUI screen that owns [screen]. */
fun AppGraph.present(
    clinic: ClinicContext,
    visitId: String,
    screen: ScreenScope,
): PresentStateHolder = present(clinic, visitId, screen.scope)
