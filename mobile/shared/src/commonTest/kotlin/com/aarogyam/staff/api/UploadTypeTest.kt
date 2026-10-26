package com.aarogyam.staff.api

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UploadTypeTest {
    @Test
    fun a_png_signature_is_recognised() {
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 13, 10, 26, 10)
        assertTrue(png.isPng())
    }

    @Test
    fun a_jpeg_or_short_file_is_not_png() {
        assertFalse(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0, 0, 0, 0, 0).isPng())
        assertFalse(byteArrayOf(0x89.toByte()).isPng())
    }
}
