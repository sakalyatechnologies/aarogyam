package com.sakalya.aarogyam.ui.patient

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sakalya.aarogyam.data.ClinicRepository
import com.sakalya.aarogyam.model.FlagKind
import com.sakalya.aarogyam.model.PatientId
import com.sakalya.aarogyam.model.ToothFdi
import com.sakalya.aarogyam.model.ToothRecord
import com.sakalya.aarogyam.ui.chart.ToothChart

private fun Long.argb(): Color = Color(this.toULong())

private val TABS = listOf("Chart", "Visits", "Rx", "Bills")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatientDetailScreen(
    repo: ClinicRepository,
    patientId: PatientId,
    onBack: () -> Unit,
    onSendPrescription: () -> Unit,
    onShareReport: () -> Unit,
) {
    val detail = remember(patientId) { repo.patientDetail(patientId) }
    val patient = detail.patient
    var tab by remember { mutableIntStateOf(0) }
    var selectedTooth by remember { mutableStateOf<ToothFdi?>(null) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(patient.name) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
                actions = { IconButton(onClick = onShareReport) { Icon(Icons.Filled.Share, contentDescription = "Share report") } },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = Color.White,
                    navigationIconContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            // Hero
            Card(modifier = Modifier.fillMaxWidth().padding(16.dp), shape = RoundedCornerShape(20.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier.size(60.dp).clip(RoundedCornerShape(18.dp)).background(patient.avatarColorArgb.argb()),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                patient.name.split(" ").map { it.first() }.joinToString(""),
                                color = Color.White, fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.titleLarge,
                            )
                        }
                        Spacer(Modifier.width(14.dp))
                        Column {
                            Text("${patient.fileNo} · ${patient.age}y ${patient.sex}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(patient.headline, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        patient.flags.forEach { flag ->
                            val c = when (flag.kind) {
                                FlagKind.Alert -> Color(0xFFB3261E)
                                FlagKind.Warn -> Color(0xFFA86E0F)
                                FlagKind.Ok -> Color(0xFF1B734A)
                                FlagKind.Info -> MaterialTheme.colorScheme.primary
                            }
                            Text(
                                flag.text, style = MaterialTheme.typography.labelSmall, color = c,
                                modifier = Modifier.background(c.copy(alpha = 0.12f), CircleShape).padding(horizontal = 10.dp, vertical = 5.dp),
                            )
                        }
                    }
                }
            }

            TabRow(selectedTabIndex = tab) {
                TABS.forEachIndexed { i, title -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(title) }) }
            }

            when (tab) {
                0 -> ChartTab(detail.teeth, selectedTooth, onSelect = { selectedTooth = it })
                1 -> LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(detail.visits) { v ->
                        Card(shape = RoundedCornerShape(14.dp)) {
                            Column(Modifier.padding(14.dp)) {
                                Text(v.date, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(v.title, fontWeight = FontWeight.SemiBold)
                                Text(v.body, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
                2 -> LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(detail.prescriptions) { rx ->
                        Card(shape = RoundedCornerShape(14.dp)) {
                            Column(Modifier.padding(14.dp)) {
                                Text("℞ ${rx.id} · ${rx.date}", fontWeight = FontWeight.SemiBold)
                                rx.items.forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium) }
                                if (rx.allergyCheckPassed) {
                                    Spacer(Modifier.height(6.dp))
                                    Text("✓ Allergy check passed", style = MaterialTheme.typography.labelSmall, color = Color(0xFF1B734A))
                                }
                            }
                        }
                    }
                }
                3 -> LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(detail.bills) { b ->
                        Card(shape = RoundedCornerShape(14.dp)) {
                            Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(b.id, style = MaterialTheme.typography.labelSmall)
                                    Text("₹${"%,d".format(b.amountPaise / 100)}", fontWeight = FontWeight.Bold)
                                }
                                Text(b.state.name.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.weight(1f))
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = onSendPrescription, modifier = Modifier.weight(1f)) { Text("℞ Send Rx") }
                OutlinedButton(onClick = onShareReport, modifier = Modifier.weight(1f)) { Text("↗ Share report") }
            }
        }
    }
}

@Composable
private fun ChartTab(teeth: List<ToothRecord>, selected: ToothFdi?, onSelect: (ToothFdi) -> Unit) {
    val record = teeth.firstOrNull { it.fdi == selected }
    LazyColumn(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Card(shape = RoundedCornerShape(18.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Dental chart · FDI", fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(8.dp))
                    ToothChart(teeth = teeth, selected = selected, onSelect = onSelect)
                    Spacer(Modifier.height(8.dp))
                    if (record != null) {
                        Text("Tooth ${record.fdi.number} · ${record.displayName}", fontWeight = FontWeight.Bold)
                        record.treatments.forEach { t ->
                            Text("• ${t.title}", style = MaterialTheme.typography.bodyMedium)
                            Text("  ${t.detail}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        Text(
                            "Tap a highlighted tooth to see its treatments.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}
