package com.aarogyam.staff.desk

import kotlin.test.Test
import kotlin.test.assertEquals

class WaitFormatTest {
    @Test
    fun underAMinuteIsJustArrived() {
        assertEquals(WaitText(WaitKind.JustArrived, 0, 0), WaitFormat.ofSeconds(0))
        assertEquals(WaitText(WaitKind.JustArrived, 0, 0), WaitFormat.ofSeconds(59))
        assertEquals(WaitText(WaitKind.JustArrived, 0, 0), WaitFormat.ofSeconds(-5))
    }

    @Test
    fun underAnHourIsMinutes() {
        assertEquals(WaitText(WaitKind.Minutes, 0, 1), WaitFormat.ofSeconds(60))
        assertEquals(WaitText(WaitKind.Minutes, 0, 59), WaitFormat.ofSeconds(3599))
    }

    @Test
    fun anHourOrMoreIsHoursAndMinutes() {
        assertEquals(WaitText(WaitKind.HoursMinutes, 1, 0), WaitFormat.ofSeconds(3600))
        assertEquals(WaitText(WaitKind.HoursMinutes, 3, 1), WaitFormat.ofSeconds(181 * 60 + 30))
    }

    @Test
    fun minutesAndSecondsAgree() {
        assertEquals(WaitFormat.ofSeconds(182 * 60), WaitFormat.ofMinutes(182))
    }
}
