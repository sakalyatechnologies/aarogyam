package com.sakalya.aarogyam

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.sakalya.aarogyam.data.FakeClinicRepository
import com.sakalya.aarogyam.model.PatientId
import com.sakalya.aarogyam.theme.BrandPresets
import com.sakalya.aarogyam.theme.paletteFor
import com.sakalya.aarogyam.ui.patient.PatientDetailScreen
import com.sakalya.aarogyam.ui.theme.ClinicTheme
import com.sakalya.aarogyam.ui.today.TodayScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repo = FakeClinicRepository()
        // In production this comes from the tenant's onboarding (white-label).
        val palette = paletteFor(BrandPresets.Tulsi)
        setContent {
            var openPatient by remember { mutableStateOf<PatientId?>(null) }
            ClinicTheme(palette = palette) {
                val current = openPatient
                if (current == null) {
                    TodayScreen(
                        repo = repo,
                        onOpenPatient = { openPatient = it },
                        onNewAppointment = { /* TODO: nav to booking */ },
                    )
                } else {
                    PatientDetailScreen(
                        repo = repo,
                        patientId = current,
                        onBack = { openPatient = null },
                        onSendPrescription = { /* TODO: share sheet via notification service */ },
                        onShareReport = { /* TODO: expiring share_links flow */ },
                    )
                }
            }
        }
    }
}
