package com.aarogyam.staff.clinic

import com.aarogyam.staff.api.model.Session
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BillsLaterTest {
    @Test
    fun onlyWhenTheMemberCollectsAndNobodyElseDoes() {
        assertTrue(billsLater(setOf("billing.write"), othersCollect = false))
        assertTrue(billsLater(setOf("payments.collect"), othersCollect = false))
        // Someone else collects, or an older server that doesn't send the field: Send to desk stays.
        assertFalse(billsLater(setOf("billing.write"), othersCollect = true))
        assertFalse(billsLater(setOf("billing.write"), othersCollect = null))
        // A member who can't collect never gets it, whatever the field says.
        assertFalse(billsLater(setOf("clinical.write"), othersCollect = false))
    }

    @Test
    fun readsTheSessionField() {
        val json = Json { ignoreUnknownKeys = true }
        val session = json.decodeFromString<Session>(sessionJson(""","others_collect":false"""))
        assertTrue(billsLater(setOf("billing.write"), session.othersCollect))
        assertFalse(billsLater(setOf("billing.write"), json.decodeFromString<Session>(sessionJson("")).othersCollect))
    }

    private fun sessionJson(extra: String): String =
        """
        {"clinic":{"id":"01920000-0000-7000-8000-000000000001","name":"Sunrise","slug":"sunrise","timezone":"Asia/Kolkata","branding":{}},
         "membership":{"id":"01920000-0000-7000-8000-000000000002","role_key":"doctor","permissions":["billing.write"]},
         "user":{"id":"01920000-0000-7000-8000-000000000003","display_name":"Dr Dev Rao"}$extra}
        """.trimIndent()
}
