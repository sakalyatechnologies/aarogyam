package com.sakalya.aarogyam.model

/**
 * Strongly-typed identifiers. Raw strings / UUIDs are never used for
 * domain values (agent rule: "Strong types").
 */
@JvmInline
value class PatientId(val value: String)

@JvmInline
value class AppointmentId(val value: String)

/** FDI World Dental Federation tooth number, e.g. 46 = lower-right first molar. */
@JvmInline
value class ToothFdi(val number: Int) {
    init {
        require(number in 11..48 && number % 10 in 1..8) {
            "Invalid FDI tooth number: $number"
        }
    }
}
