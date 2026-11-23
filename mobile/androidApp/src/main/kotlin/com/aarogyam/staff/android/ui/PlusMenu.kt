package com.aarogyam.staff.android.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.aarogyam.staff.AppGraph
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.patient.openPatient
import com.aarogyam.staff.android.ui.schedule.BookFlow
import com.aarogyam.staff.android.ui.schedule.RegisterAndBook
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkModalSheet

/** What the bar's "+" can open: walk-in always, add patient only with `patients.write`, booking with `appointments.write`. */
enum class PlusChoice { WalkIn, AddPatient, Book }

object PlusChoices {
    fun of(permissions: Set<String>): List<PlusChoice> =
        buildList {
            add(PlusChoice.WalkIn)
            if ("patients.write" in permissions) add(PlusChoice.AddPatient)
            if ("appointments.write" in permissions) add(PlusChoice.Book)
        }
}

/**
 * The "+" menu, plus the sheets its choices open. It opens beside the action: just above the bottom bar's end on a
 * phone, beside the rail's action on a wide screen ([wide]).
 */
@Composable
fun PlusMenu(
    open: Boolean,
    choices: List<PlusChoice>,
    graph: AppGraph,
    clinic: ClinicContext,
    nav: NavController,
    onWalkIn: () -> Unit,
    onDismiss: () -> Unit,
    wide: Boolean = false,
) {
    var sheet by rememberSaveable { mutableStateOf<PlusChoice?>(null) }
    val edge =
        if (wide) {
            Modifier.fillMaxSize().statusBarsPadding().padding(start = RAIL_WIDTH.dp, top = ACTION_INSET.dp)
        } else {
            Modifier.fillMaxSize().navigationBarsPadding().padding(end = Spacing.ML.dp, bottom = ACTION_INSET.dp)
        }
    Box(edge, contentAlignment = if (wide) Alignment.TopStart else Alignment.BottomEnd) {
        // A zero-size anchor at the action: the menu drops from it, or rises above it when there is no room below.
        Box(Modifier.size(0.dp)) {
            DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
                choices.forEach { choice ->
                    DropdownMenuItem(
                        text = { Text(stringResource(choice.label())) },
                        onClick = {
                            onDismiss()
                            if (choice == PlusChoice.WalkIn) onWalkIn() else sheet = choice
                        },
                    )
                }
            }
        }
    }
    when (sheet) {
        PlusChoice.Book -> {
            BookFlow(graph, clinic) { sheet = null }
        }

        PlusChoice.AddPatient -> {
            val scope = rememberCoroutineScope()
            val holder = remember { graph.quickRegister(clinic, scope) }
            SkModalSheet(title = stringResource(R.string.v7_plus_add_patient), onDismiss = { sheet = null }) {
                RegisterAndBook(holder, "", { id ->
                    sheet = null
                    nav.openPatient(id)
                }, R.string.v7_plus_add_submit)
            }
        }

        else -> {}
    }
}

private fun PlusChoice.label(): Int =
    when (this) {
        PlusChoice.WalkIn -> R.string.v7_plus_walk_in
        PlusChoice.AddPatient -> R.string.v7_plus_add_patient
        PlusChoice.Book -> R.string.sh_s_book_title
    }

private const val RAIL_WIDTH = 80
private const val ACTION_INSET = 72
