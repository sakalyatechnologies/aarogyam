package com.sakalya.aarogyam.ui.chart

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sakalya.aarogyam.model.ToothFdi
import com.sakalya.aarogyam.model.ToothRecord
import com.sakalya.aarogyam.model.ToothStatus

private val UPPER = listOf(18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28)
private val LOWER = listOf(48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38)

/**
 * 32-tooth FDI chart. Pure function of [teeth]; selection is hoisted
 * to the caller so it works identically on iOS (SwiftUI).
 */
@Composable
fun ToothChart(
    teeth: List<ToothRecord>,
    selected: ToothFdi?,
    onSelect: (ToothFdi) -> Unit,
    modifier: Modifier = Modifier,
) {
    val byFdi = teeth.associateBy { it.fdi.number }
    Column(modifier = modifier) {
        ArchLabel("UPPER ARCH")
        ToothRow(UPPER, byFdi, selected, onSelect)
        ArchLabel("LOWER ARCH")
        ToothRow(LOWER, byFdi, selected, onSelect)
    }
}

@Composable
private fun ArchLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(vertical = 6.dp),
    )
}

@Composable
private fun ToothRow(
    numbers: List<Int>,
    byFdi: Map<Int, ToothRecord>,
    selected: ToothFdi?,
    onSelect: (ToothFdi) -> Unit,
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(16),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier
            .fillMaxWidth()
            // 16 columns × ~2 rows would scroll; fix height for exactly one row
            .padding(bottom = 2.dp),
        userScrollEnabled = false,
    ) {
        items(numbers) { n ->
            val record = byFdi[n]
            val status = record?.status ?: ToothStatus.Healthy
            ToothCell(
                number = n,
                status = status,
                isSelected = selected?.number == n,
                onClick = { onSelect(ToothFdi(n)) },
            )
        }
    }
}

@Composable
private fun ToothCell(number: Int, status: ToothStatus, isSelected: Boolean, onClick: () -> Unit) {
    val (border, bg, fg) = when (status) {
        ToothStatus.Healthy -> Triple(Color(0xFFE3E9E5), Color.Transparent, Color(0xFF6B7D74))
        ToothStatus.Treated -> Triple(Color(0xFF1B734A), Color(0xFFDDF2E5), Color(0xFF1B734A))
        ToothStatus.RootCanal -> Triple(Color(0xFF4338CA), Color(0xFFE8E8FB), Color(0xFF4338CA))
        ToothStatus.Planned -> Triple(Color(0xFFA86E0F), Color(0xFFF9EFDA), Color(0xFFA86E0F))
        ToothStatus.Watch -> Triple(Color(0xFFB3261E), Color.Transparent, Color(0xFFB3261E))
    }
    val shape = RoundedCornerShape(6.dp)
    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .aspectRatio(0.8f)
            .clip(shape)
            .background(bg)
            .border(
                width = if (isSelected) 2.5.dp else 1.5.dp,
                color = if (isSelected) MaterialTheme.colorScheme.primary else border,
                shape = shape,
            )
            .clickable(onClick = onClick),
    ) {
        Text(text = number.toString(), fontSize = 8.sp, fontWeight = FontWeight.Bold, color = fg)
    }
}
