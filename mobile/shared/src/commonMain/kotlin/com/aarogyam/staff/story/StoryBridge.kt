package com.aarogyam.staff.story

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/**
 * The story WebView's bridge (design §1.7, §1.12): the web bundle shipped in the app hosts the
 * mouth view (Present mode) and the video renderer. Native calls the page through
 * `window.aarogyam`; the page answers on one channel (`window.webkit.messageHandlers.aarogyam` on
 * iOS, `AarogyamBridge.post` on Android) with a JSON message per call.
 *
 * The bundle is built by the backend under `web/` and synced into `mobile/story-bundle/story/`
 * (a placeholder page until then). It loads nothing from the network.
 */
object StoryBridge {
    /** The channel name on both platforms. */
    const val CHANNEL = "aarogyam"

    /** The Android `@JavascriptInterface` object's name. */
    const val ANDROID_INTERFACE = "AarogyamBridge"

    /** The bundle versions this app can drive; a page that reports another one is not used. */
    val SUPPORTED_VERSIONS: IntRange = 1..1

    /** The bundle's entry page, under the secure origin of each platform. */
    const val ANDROID_ENTRY = "https://appassets.androidplatform.net/story/index.html"
    const val IOS_SCHEME = "aarostory"
    const val IOS_ENTRY = "aarostory://story/index.html"

    /** Shows the mouth snapshot full screen (Present mode). [mouth] is `/visits/{id}/mouth`, untouched. */
    fun present(
        mouth: JsonObject,
        dark: Boolean,
    ): String = "window.aarogyam.present(${call(mouth)}, ${call(buildJsonObject { put("dark", dark) })})"

    /** Goes "Back to all teeth"; the page answers true, or false at the overview so the screen leaves. */
    const val BACK: String = "window.aarogyam.back()"

    /** Starts the patient's video from `/visits/{id}/story`, untouched. */
    fun render(story: JsonObject): String = "window.aarogyam.render(${call(story)})"

    const val CANCEL: String = "window.aarogyam.cancel()"

    /** True when the page's answer to [BACK] means it went back inside the page. */
    fun wentBack(answer: String?): Boolean = answer?.trim() == "true"

    /**
     * JSON is a JavaScript expression, but U+2028 and U+2029 end a line in older engines, so they
     * are escaped before the text goes into a script.
     */
    private fun call(json: JsonObject): String =
        json.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")

    private val lenient = Json { ignoreUnknownKeys = true }

    /** Reads one message from the page; anything unknown or malformed is null and ignored. */
    @OptIn(ExperimentalEncodingApi::class)
    fun parse(text: String): PageMessage? {
        val body = runCatching { lenient.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null

        fun str(key: String) = (body[key] as? JsonPrimitive)?.contentOrNull

        fun int(key: String) = (body[key] as? JsonPrimitive)?.intOrNull
        return when (str("type")) {
            "ready" -> {
                int("bundle_version")?.let { PageMessage.Ready(it) }
            }

            "progress" -> {
                (body["value"] as? JsonPrimitive)?.doubleOrNull?.let { PageMessage.Progress(it.coerceIn(0.0, 1.0)) }
            }

            "chunk" -> {
                val seq = int("seq")
                val bytes = str("base64")?.let { runCatching { Base64.decode(it) }.getOrNull() }
                if (seq == null || bytes == null) null else PageMessage.Chunk(seq, bytes)
            }

            "done" -> {
                body["bytes"]?.jsonPrimitive?.longOrNull?.let { PageMessage.Done(it) }
            }

            "failed" -> {
                PageMessage.Failed(str("reason") ?: "unknown")
            }

            "exit" -> {
                PageMessage.Exit
            }

            "add_depth" -> {
                int("tooth")?.let { PageMessage.AddDepth(it) }
            }

            else -> {
                null
            }
        }
    }
}

/** A message from the story page. */
sealed interface PageMessage {
    /** The page loaded; [bundleVersion] says which bridge it speaks. */
    data class Ready(
        val bundleVersion: Int,
    ) : PageMessage

    /** Video progress, 0 to 1. */
    data class Progress(
        val value: Double,
    ) : PageMessage

    /** Part [seq] of the video file (512 KB at most). */
    class Chunk(
        val seq: Int,
        val bytes: ByteArray,
    ) : PageMessage

    /** The video is complete at [bytes] long. */
    data class Done(
        val bytes: Long,
    ) : PageMessage

    /** The render stopped; [reason] is a short code, never patient data. */
    data class Failed(
        val reason: String,
    ) : PageMessage

    /** The doctor held Exit. */
    data object Exit : PageMessage

    /** The doctor tapped "Add depth" on [tooth]. */
    data class AddDepth(
        val tooth: Int,
    ) : PageMessage
}
