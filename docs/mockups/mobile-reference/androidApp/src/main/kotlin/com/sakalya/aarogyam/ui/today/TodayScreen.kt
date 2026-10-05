package com.sakalya.aarogyam.ui.today

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.sakalya.aarogyam.data.ClinicRepository
import com.sakalya.aarogyam.model.Alert
import com.sakalya.aarogyam.model.Appointment
import com.sakalya.aarogyam.model.AppointmentState
import com.sakalya.aarogyam.model.FlagKind
import com.sakalya.aarogyam.model.PatientId

private fun Long.argb(): Color = Color(this.toULong())

private fun stateChip(state: AppointmentState): Pair<String, Color> = when (state) {
    AppointmentState.Done -> "DONE" to Color(0xFF1B734A)
    AppointmentState.Waiting -> "WAITING" to Color(0xFFA86E0F)
    AppointmentState.Next -> "NEXT" to Color(0xFF136650)
    AppointmentState.Booked -> "BOOKED" to Color(0xFF4338CA)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    repo: ClinicRepository,
    onOpenPatient: (PatientId) -> Unit,
    onNewAppointment: () -> Unit,
) {
    val dash = repo.today()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Aarogyam", fontWeight = FontWeight.SemiBold) },
                actions = { IconButton(onClick = {}) { Icon(Icons.Filled.Notifications, contentDescription = "Notifications") } },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = Color.White,
                    actionIconContentColor = Color.White,
                ),
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewAppointment) {
                Icon(Icons.Filled.Add, contentDescription = "New appointment")
            }
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(selected = true, onClick = {}, icon = { Icon(Icons.Filled.Home, null) }, label = { Text("Today") })
                NavigationBarItem(selected = false, onClick = {}, icon = { Icon(Icons.Filled.Person, null) }, label = { Text("Patients") })
                NavigationBarItem(selected = false, onClick = {}, icon = { Icon(Icons.Filled.DateRange, null) }, label = { Text("Calendar") })
            }
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text(
                    text = "${dash.greeting} · ${dash.clinicName}",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    dash.stats.forEach { stat ->
                        StatCard(label = stat.label, value = stat.value, delta = stat.delta, modifier = Modifier.weight(1f))
                    }
                }
            }
            item {
                // "Up next" hero — gradient card driven by the brand palette
                val primary = MaterialTheme.colorScheme.primary
                Card(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clickable { /* start visit */ },
                    shape = RoundedCornerShape(20.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.Transparent),
                ) {
                    Box(
                        modifier = Modifier
                            .background(Brush.linearGradient(listOf(primary, primary.copy(alpha = 0.75f))))
                            .padding(18.dp),
                    ) {
                        Column {
                            Text("UP NEXT · ${dash.upNext.time}", style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.8f))
                            Spacer(Modifier.height(6.dp))
                            Text(dash.upNext.patientName, style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
                            Text("${dash.upNext.title} · ${dash.upNext.chair} · lab work ready ✓", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.85f))
                        }
                    }
                }
            }
            item {
                Text("Schedule", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 16.dp))
            }
            items(dash.schedule) { appt ->
                AppointmentRow(appt, onClick = { /* appointments carry patientId in real impl */ })
            }
            item {
                Text("Needs attention", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 16.dp))
            }
            items(dash.alerts) { alert -> AlertRow(alert) }
            item { Spacer(Modifier.height(72.dp)) }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, delta: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(delta, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun AppointmentRow(appt: Appointment, onClick: () -> Unit) {
    val (label, color) = stateChip(appt.state)
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).clickable(onClick = onClick),
        shape = RoundedCornerShape(16.dp),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(appt.avatarColorArgb.argb()),
                contentAlignment = Alignment.Center,
            ) { Text(appt.patientInitials, color = Color.White, fontWeight = FontWeight.Bold) }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(appt.patientName, fontWeight = FontWeight.SemiBold)
                Text("${appt.time} · ${appt.title}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = color,
                modifier = Modifier.background(color.copy(alpha = 0.12f), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun AlertRow(alert: Alert) {
    val color = when (alert.severity) {
        FlagKind.Alert -> Color(0xFFB3261E)
        FlagKind.Warn -> Color(0xFFA86E0F)
        FlagKind.Ok -> Color(0xFF1B734A)
        FlagKind.Info -> MaterialTheme.colorScheme.primary
    }
    Card(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(color))
            Spacer(Modifier.width(12.dp))
            Column {
                Text(alert.title, fontWeight = FontWeight.SemiBold)
                Text(alert.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
