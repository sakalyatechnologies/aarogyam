package com.aarogyam.staff.desk

import kotlin.test.Test
import kotlin.test.assertEquals

class FamilyChipsTest {
    private fun relative(relation: String) = Relative("l1", "p2", "SD-2", "Asha", relation, false)

    @Test
    fun a_relative_who_is_a_child_makes_the_patient_their_parent_and_back() {
        assertEquals(FamilyChip.ParentOf, relative("child").chip())
        assertEquals(FamilyChip.ChildOf, relative("parent").chip())
        assertEquals(FamilyChip.SpouseOf, relative("spouse").chip())
        assertEquals(FamilyChip.SiblingOf, relative("sibling").chip())
        assertEquals(FamilyChip.WardOf, relative("guardian").chip())
        assertEquals(FamilyChip.RelatedTo, relative("other").chip())
        assertEquals(FamilyChip.RelatedTo, relative("cousin").chip())
    }
}
