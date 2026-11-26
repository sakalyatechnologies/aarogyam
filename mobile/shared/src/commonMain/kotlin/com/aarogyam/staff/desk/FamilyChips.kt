package com.aarogyam.staff.desk

/** How the open patient relates to a relative, for the Patient 360 chips ("Parent of Asha"). */
enum class FamilyChip { ParentOf, ChildOf, SpouseOf, SiblingOf, WardOf, RelatedTo }

/**
 * The chip for [Relative.relation], which is what the relative is to the open patient: a relative who is
 * the patient's `child` makes the patient their parent. An unknown relation reads as [FamilyChip.RelatedTo].
 */
fun Relative.chip(): FamilyChip =
    when (relation) {
        "child" -> FamilyChip.ParentOf
        "parent" -> FamilyChip.ChildOf
        "spouse" -> FamilyChip.SpouseOf
        "sibling" -> FamilyChip.SiblingOf
        "guardian" -> FamilyChip.WardOf
        else -> FamilyChip.RelatedTo
    }
