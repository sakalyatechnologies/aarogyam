package com.aarogyam.staff.android.ui.desk

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.aarogyam.staff.android.R
import com.aarogyam.staff.android.ui.LoadingIndicator
import com.aarogyam.staff.android.ui.message
import com.aarogyam.staff.android.ui.walkin.PickChip
import com.aarogyam.staff.desk.FamilyState
import com.aarogyam.staff.desk.FamilyStateHolder
import com.aarogyam.staff.desk.LinkCandidate
import com.aarogyam.staff.desk.LinkProblem
import com.aarogyam.staff.desk.LinkSearch
import com.aarogyam.staff.desk.linkProblems
import com.sakalya.mobile.design.Spacing
import com.sakalya.mobile.designcompose.SkBottomSheet
import com.sakalya.mobile.designcompose.SkButton
import com.sakalya.mobile.designcompose.SkButtonVariant
import com.sakalya.mobile.designcompose.SkCard
import com.sakalya.mobile.designcompose.SkTextField
import com.sakalya.mobile.designcompose.SkTheme
import com.sakalya.mobile.designcompose.SkTypography
import com.sakalya.mobile.designcompose.color

/** What the new relative is to the person they are linked to (`family_of.relation`). */
enum class DeskRelation(
    val wire: String,
) {
    Guardian("guardian"),
    Child("child"),
    Spouse("spouse"),
    Parent("parent"),
    Sibling("sibling"),
    Other("other"),
}

/** The word for a relation the server sent; an unknown one reads as Other. */
@Composable
fun relationTitle(wire: String): String =
    stringResource(
        when (wire) {
            "guardian" -> R.string.dk_d9_rel_guardian
            "child" -> R.string.dk_d9_rel_child
            "spouse" -> R.string.dk_d9_rel_spouse
            "parent" -> R.string.dk_d9_rel_parent
            "sibling" -> R.string.dk_d9_rel_sibling
            else -> R.string.dk_d9_rel_other
        },
    )

/** Relation chips, as on the intake form and the link form. */
@Composable
fun RelationChips(
    selected: DeskRelation?,
    onPick: (DeskRelation) -> Unit,
) {
    DeskWrap {
        DeskRelation.entries.forEach { PickChip(relationTitle(it.wire), selected == it, onClick = { onPick(it) }) }
    }
}

/** The family section of the desk flow: a patient's relatives, and removing or adding a link. */
@Composable
fun DeskFamilySheet(
    holder: FamilyStateHolder,
    name: String,
    patientId: String,
    onDismiss: () -> Unit,
) {
    val state by holder.state.collectAsStateWithLifecycle()
    SkBottomSheet(
        title = stringResource(R.string.dk_d9_family_section),
        subtitle = stringResource(R.string.dk_d9_family_of, name),
        onDismiss = onDismiss,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp),
        ) {
            when (val current = state) {
                FamilyState.Loading -> {
                    LoadingIndicator()
                }

                FamilyState.NotAllowed -> {
                    DeskMutedText(stringResource(R.string.dk_d9_lookup_not_allowed_message))
                }

                is FamilyState.Failed -> {
                    DeskErrorText(stringResource(current.error.message()))
                    SkButton(
                        stringResource(R.string.try_again),
                        onClick = holder::refresh,
                        variant = SkButtonVariant.Secondary,
                    )
                }

                is FamilyState.Loaded -> {
                    RelativesList(current, holder, patientId)
                }
            }
        }
    }
}

@Composable
private fun RelativesList(
    loaded: FamilyState.Loaded,
    holder: FamilyStateHolder,
    patientId: String,
) {
    var linking by remember { mutableStateOf(false) }
    loaded.actionError?.let { DeskErrorText(stringResource(it.message())) }
    if (loaded.items.isEmpty()) DeskMutedText(stringResource(R.string.dk_d9_family_none))
    loaded.items.forEach { person ->
        SkCard(Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(person.name, style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
                    Text(
                        relationTitle(person.relation) + " · " + person.number,
                        style = SkTypography.footnote,
                        color = SkTheme.colors.textMuted.color,
                    )
                }
                if (loaded.canEdit) {
                    SkButton(
                        stringResource(R.string.dk_d9_family_remove),
                        onClick = { holder.remove(person.linkId) },
                        variant = SkButtonVariant.Secondary,
                    )
                }
            }
        }
    }
    if (loaded.canEdit) {
        if (linking) {
            LinkExisting(holder, patientId, loaded.items.map { it.patientId }.toSet()) { linking = false }
        } else {
            SkButton(
                stringResource(R.string.dk_d9_family_link),
                onClick = { linking = true },
                variant = SkButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** "Link existing patient": search by number, pick the patient and the relation, then link. */
@Composable
private fun LinkExisting(
    holder: FamilyStateHolder,
    patientId: String,
    linkedIds: Set<String>,
    onDone: () -> Unit,
) {
    val search by holder.search.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<LinkCandidate?>(null) }
    var relation by remember { mutableStateOf<DeskRelation?>(null) }
    var showProblems by remember { mutableStateOf(false) }
    val problems = linkProblems(patientId, picked?.patientId, relation?.wire, linkedIds)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.SM.dp)) {
        SkTextField(
            value = query,
            onValueChange = {
                query = it
                picked = null
                holder.searchCandidates(it)
            },
            label = stringResource(R.string.dk_d9_family_link_field),
        )
        when (val found = search) {
            LinkSearch.Idle -> {
                // Nothing to draw.
            }

            LinkSearch.Searching -> {
                DeskMutedText(stringResource(R.string.loading))
            }

            is LinkSearch.Failed -> {
                DeskErrorText(stringResource(found.error.message()))
            }

            is LinkSearch.Found -> {
                if (found.items.isEmpty()) DeskMutedText(stringResource(R.string.dk_d9_family_link_none))
                found.items.forEach { item ->
                    SkCard(Modifier.fillMaxWidth(), onClick = { picked = item }) {
                        Text(item.name, style = SkTypography.bodyStrong, color = SkTheme.colors.text.color)
                        Text(
                            item.number + if (picked?.patientId == item.patientId) " ✓" else "",
                            style = SkTypography.footnote,
                            color = SkTheme.colors.textMuted.color,
                        )
                    }
                }
            }
        }
        DeskLabel(stringResource(R.string.dk_d9_family_link_relation))
        RelationChips(relation) { relation = it }
        if (showProblems) problems.forEach { DeskErrorText(stringResource(linkProblemText(it))) }
        SkButton(
            stringResource(R.string.dk_d9_family_link_submit),
            onClick = {
                showProblems = true
                val chosen = picked
                val relationPicked = relation
                if (problems.isEmpty() && chosen != null && relationPicked != null) {
                    holder.add(chosen.patientId, relationPicked.wire, primaryContact = false)
                    holder.clearSearch()
                    onDone()
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

private fun linkProblemText(problem: LinkProblem): Int =
    when (problem) {
        LinkProblem.NoPatient -> R.string.dk_d9_family_link_need_patient
        LinkProblem.Themselves -> R.string.dk_d9_family_link_self
        LinkProblem.AlreadyLinked -> R.string.dk_d9_family_link_already
        LinkProblem.BadRelation -> R.string.dk_d9_family_link_need_relation
    }
