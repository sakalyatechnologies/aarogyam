package com.aarogyam.staff.android.ui.clinical

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

class ClinicalFormatTest {
    private val zone = ZoneId.of("UTC")
    private val now = Instant.parse("2026-11-15T12:00:00Z")

    @Test
    fun chatTimeToday() {
        assertEquals("10:42", ClinicalFormat.chatTime("2026-11-15T10:42:00Z", now, zone, Locale.UK))
    }

    @Test
    fun chatTimeWithinWeekAndOlder() {
        assertEquals("Fri 10:42", ClinicalFormat.chatTime("2026-11-13T10:42:00Z", now, zone, Locale.UK))
        assertEquals("1 Nov", ClinicalFormat.chatTime("2026-11-01T10:42:00Z", now, zone, Locale.UK))
        assertEquals("", ClinicalFormat.chatTime("nonsense", now, zone, Locale.UK))
    }

    @Test
    fun openableOnlyWeb() {
        assertEquals("https://a.example/f", ClinicalFormat.openable("https://a.example/f"))
        assertNull(ClinicalFormat.openable("file:///etc/passwd"))
        assertNull(ClinicalFormat.openable("javascript:alert(1)"))
    }

    @Test
    fun waLinkOnlyWaMe() {
        assertEquals("https://wa.me/9198?text=x", ClinicalFormat.whatsAppLink("https://wa.me/9198?text=x"))
        assertNull(ClinicalFormat.whatsAppLink("https://evil.example/wa.me"))
        assertNull(ClinicalFormat.whatsAppLink("http://wa.me/1"))
        assertNull(ClinicalFormat.whatsAppLink(null))
    }

    @Test
    fun phoneLinks() {
        assertEquals("tel:+919812345678", ClinicalFormat.tel("+91 98123 45678"))
        assertNull(ClinicalFormat.tel(null))
        assertEquals("https://wa.me/919812345678?text=Hi%20there", ClinicalFormat.whatsApp("9812345678", "Hi there"))
        assertNull(ClinicalFormat.whatsApp("12345"))
    }

    @Test
    fun sizesAndDates() {
        assertEquals("340 KB", ClinicalFormat.sizeLabel(340 * 1024L))
        assertEquals("1.2 MB", ClinicalFormat.sizeLabel((1.2 * 1024 * 1024).toLong()))
        assertEquals(true, ClinicalFormat.isOverdue("2026-10-01", "2026-10-09"))
        assertEquals("a · c", ClinicalFormat.joinDot(listOf("a", null, "c", " ")))
    }
}
