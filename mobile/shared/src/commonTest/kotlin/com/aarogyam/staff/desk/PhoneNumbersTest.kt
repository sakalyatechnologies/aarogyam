package com.aarogyam.staff.desk

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PhoneNumbersTest {
    @Test
    fun common_indian_formats_become_e164() {
        listOf("9876543210", "98765 43210", "09876543210", "+91 98765-43210", "919876543210", "(+91) 98765 43210")
            .forEach { assertEquals("+919876543210", normaliseIndianPhone(it), it) }
    }

    @Test
    fun incomplete_or_invalid_numbers_are_null() {
        listOf("", "98765", "5876543210", "98765432101", "+91 98765 4321").forEach { assertNull(normaliseIndianPhone(it), it) }
    }

    @Test
    fun initials_use_first_and_last_words() {
        assertEquals("MS", initialsOf("Meera Shah"))
        assertEquals("RK", initialsOf("ravi  kumar kulkarni"))
        assertEquals("A", initialsOf("Asha"))
    }
}
