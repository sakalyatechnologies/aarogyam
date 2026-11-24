package com.aarogyam.staff.story

import com.aarogyam.staff.api.attachmentLink
import com.aarogyam.staff.api.attachmentPins
import com.aarogyam.staff.api.attachmentsRaw
import com.aarogyam.staff.api.dentalChartRaw
import com.aarogyam.staff.api.presentDiscussions
import com.aarogyam.staff.clinic.ClinicContext
import com.sakalya.mobile.core.Outcome
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** One X-ray the page may show; its signed link is fetched fresh in [PresentExtras.xrayOptions]. */
internal class PresentXray(
    val id: String,
    val takenAt: String?,
    val pins: JsonArray,
)

/**
 * What Show patient shows beside the mouth (bridge v3): the patient's X-rays with pins, the dental
 * chart and the visit's saved discussions. Any part that failed to load is null or empty and left
 * out, so the page still opens.
 */
internal class PresentExtras(
    val xrays: List<PresentXray> = emptyList(),
    val chart: JsonObject? = null,
    val discussions: JsonObject? = null,
) {
    /** The `xrays` option with links signed now (they last five minutes); an X-ray whose link fails is left out. */
    suspend fun xrayOptions(
        clinic: ClinicContext,
        edits: Map<String, JsonArray> = emptyMap(),
    ): JsonArray? {
        if (xrays.isEmpty()) return null
        val signed =
            coroutineScope {
                xrays
                    .map { x ->
                        async { (clinic.api.attachmentLink(x.id) as? Outcome.Success)?.value?.url?.let { x to it } }
                    }.awaitAll()
            }.filterNotNull()
        val items =
            signed.map { (x, link) ->
                val url = if (link.startsWith("/")) clinic.api.origin + link else link
                JsonObject(
                    buildMap {
                        put("id", JsonPrimitive(x.id))
                        put("url", JsonPrimitive(url))
                        x.takenAt?.let { put("taken_at", JsonPrimitive(it)) }
                        put("kind", JsonPrimitive("xray"))
                        put("pins", edits[x.id] ?: x.pins)
                    },
                )
            }
        return items.takeIf { it.isNotEmpty() }?.let { JsonArray(it) }
    }

    companion object {
        const val MAX_XRAYS = 6

        suspend fun fetch(
            clinic: ClinicContext,
            visitId: String,
            patientId: String,
        ): PresentExtras =
            coroutineScope {
                val chart = async { (clinic.api.dentalChartRaw(patientId) as? Outcome.Success)?.value }
                val discussions = async { (clinic.api.presentDiscussions(visitId) as? Outcome.Success)?.value }
                val files = (clinic.api.attachmentsRaw(patientId) as? Outcome.Success)?.value
                val picked = pick(files, visitId)
                val pins =
                    picked
                        .map { async { (clinic.api.attachmentPins(it.first) as? Outcome.Success)?.value?.get("pins") } }
                        .awaitAll()
                val xrays =
                    picked.mapIndexed { i, (id, takenAt) ->
                        PresentXray(id, takenAt, pins[i] as? JsonArray ?: JsonArray(emptyList()))
                    }
                PresentExtras(xrays, chart.await(), discussions.await())
            }

        /** Image X-rays as (id, taken_at): this visit's first, then the newest (the list is newest first). */
        internal fun pick(
            files: JsonObject?,
            visitId: String,
        ): List<Pair<String, String?>> {
            val items = files?.get("items") as? JsonArray ?: return emptyList()
            val xrays =
                items.mapNotNull { it as? JsonObject }.filter {
                    text(it, "kind") == "xray" && text(it, "mime_type")?.startsWith("image/") == true &&
                        text(it, "id") != null
                }
            val (here, others) = xrays.partition { text(it, "visit_id") == visitId }
            return (here + others).take(MAX_XRAYS).map { x ->
                text(x, "id")!! to (text(x, "taken_at") ?: text(x, "created_at"))
            }
        }

        private fun text(
            o: JsonObject,
            key: String,
        ): String? = (o[key] as? JsonPrimitive)?.contentOrNull
    }
}
