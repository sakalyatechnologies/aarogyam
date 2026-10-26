package com.aarogyam.staff.desk

private val MOBILE = Regex("^[6-9]\\d{9}$")
private const val NATIONAL = 10

/**
 * An Indian mobile as E.164 (`+91XXXXXXXXXX`), or null when [typed] is not a complete number.
 * Accepts spaces, dashes, brackets, a `+91` or `91` prefix and a trunk `0`.
 */
fun normaliseIndianPhone(typed: String): String? {
    val digits = typed.filter { it.isDigit() }
    val national =
        when {
            digits.length == NATIONAL + 2 && digits.startsWith("91") -> digits.drop(2)
            digits.length == NATIONAL + 1 && digits.startsWith("0") -> digits.drop(1)
            else -> digits
        }
    return if (MOBILE.matches(national)) "+91$national" else null
}
