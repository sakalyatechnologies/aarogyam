package com.aarogyam.staff.live

/** One dispatched server-sent event. [event] defaults to `message`; [data] lines are joined with `\n`. */
data class SseFrame(
    val event: String,
    val data: String,
    /** The stream's last event id when this frame was dispatched, or null when the server never sent one. */
    val id: String?,
)

/**
 * Line parser for `text/event-stream`, with no I/O: feed it one line at a time (line terminator
 * already removed). Follows the WHATWG rules: `event`, `data`, `id` fields (one optional space after
 * the colon is dropped), `:` comment lines ignored, `retry` ignored (backoff is ours), unknown fields
 * ignored, a field with no colon has an empty value, and a blank line dispatches.
 *
 * One deliberate difference: a blank line also dispatches a frame that has an `event:` but no `data:`
 * (such as a bare `event: reset`), where the spec would drop it.
 */
class SseParser(
    initialLastEventId: String? = null,
) {
    private var event: String? = null
    private val data = StringBuilder()
    private var hasData = false
    private var first = true

    /** The last `id:` seen; it survives across frames and is what a reconnect sends as `Last-Event-ID`. */
    var lastEventId: String? = initialLastEventId
        private set

    /** Handles one [rawLine]; returns the frame when it was a dispatching blank line. */
    fun feed(rawLine: String): SseFrame? {
        var line = rawLine
        if (first) {
            first = false
            line = line.removePrefix(BOM)
        }
        line = line.removeSuffix("\r")
        if (line.isEmpty()) return dispatch()
        if (line.startsWith(':')) return null
        val colon = line.indexOf(':')
        val field = if (colon < 0) line else line.substring(0, colon)
        val value = if (colon < 0) "" else line.substring(colon + 1).removePrefix(" ")
        when (field) {
            "event" -> {
                event = value
            }

            "data" -> {
                if (hasData) data.append('\n')
                data.append(value)
                hasData = true
            }

            // An id with a NUL is ignored; an empty id resets the last id to empty.
            "id" -> {
                if ('\u0000' !in value) lastEventId = value
            }
        }
        return null
    }

    private fun dispatch(): SseFrame? {
        val name = event
        val frame =
            if (hasData || !name.isNullOrEmpty()) {
                SseFrame(name?.takeIf { it.isNotEmpty() } ?: "message", data.toString(), lastEventId)
            } else {
                null
            }
        event = null
        data.clear()
        hasData = false
        return frame
    }
}

private val BOM = Char(0xFEFF).toString()
