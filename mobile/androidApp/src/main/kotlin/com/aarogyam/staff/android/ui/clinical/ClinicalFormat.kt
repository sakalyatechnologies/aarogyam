package com.aarogyam.staff.android.ui.clinical

import java.net.URI
import java.text.DecimalFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

/** Pure text and link rules for the clinical screens (JVM-tested in `ClinicalFormatTest`). */
object ClinicalFormat {
    /** A bubble's time: "10:42" today, "Mon 10:42" within the week, else "5 Oct"; empty when [text] does not parse. */
    fun chatTime(
        text: String,
        now: Instant = Instant.now(),
        zone: ZoneId = ZoneId.systemDefault(),
        locale: Locale = Locale.getDefault(),
    ): String {
        val at = runCatching { Instant.parse(text) }.getOrNull() ?: return ""
        val date = at.atZone(zone)
        val today = now.atZone(zone).toLocalDate()
        val time = date.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale))
        val days = ChronoUnit.DAYS.between(date.toLocalDate(), today)
        return when {
            days == 0L -> time
            days in 1..6 -> date.format(DateTimeFormatter.ofPattern("EEE", locale)) + " " + time
            else -> date.format(DateTimeFormatter.ofPattern("d MMM", locale))
        }
    }

    /** The link only when it is plain web (http or https) with a host; anything else is not opened. */
    fun openable(link: String): String? {
        val uri = runCatching { URI(link) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()
        return link.takeIf { (scheme == "https" || scheme == "http") && !uri.host.isNullOrEmpty() }
    }

    /** "340 KB", "1.2 MB". */
    fun sizeLabel(bytes: Long): String =
        when {
            bytes >= MB -> DecimalFormat("0.#").format(bytes / MB.toDouble()) + " MB"
            bytes >= KB -> DecimalFormat("0").format(bytes / KB.toDouble()) + " KB"
            else -> "$bytes B"
        }

    /** Only a `https://wa.me` link opens; anything else the server sends is ignored. */
    fun whatsAppLink(text: String?): String? {
        val uri = runCatching { URI(text ?: return null) }.getOrNull() ?: return null
        return text.takeIf { uri.scheme == "https" && uri.host == "wa.me" }
    }

    /** `tel:` target: the digits with a leading plus kept; null for no number. */
    fun tel(phone: String?): String? {
        val digits = phone?.filter { it in '0'..'9' }.orEmpty()
        if (digits.isEmpty()) return null
        return "tel:" + (if (phone?.trim()?.startsWith("+") == true) "+" else "") + digits
    }

    /** `https://wa.me/<number>`, a ten-digit Indian number given its country code; [message] is the prefilled text. */
    fun whatsApp(
        phone: String?,
        message: String? = null,
    ): String? {
        var number = phone?.filter { it in '0'..'9' } ?: return null
        if (number.length == 10) number = "91$number"
        if (number.length < 11) return null
        val text =
            message?.takeIf { it.isNotEmpty() }?.let {
                "?text=" +
                    java.net.URLEncoder
                        .encode(it, "UTF-8")
                        .replace("+", "%20")
            }
        return "https://wa.me/$number" + text.orEmpty()
    }

    /** True when a due date (`2026-10-09`) is before [today] (same format). */
    fun isOverdue(
        dueOn: String?,
        today: String,
    ): Boolean = dueOn != null && dueOn < today

    /** Today as `YYYY-MM-DD` in the clinic's time zone. */
    fun today(
        zone: String,
        now: Instant = Instant.now(),
    ): String {
        val id = runCatching { ZoneId.of(zone) }.getOrDefault(ZoneId.systemDefault())
        return now.atZone(id).toLocalDate().toString()
    }

    /** `Pune · ~5 days · Crown, Aligner` pieces joined with a middle dot, leaving out what is missing. */
    fun joinDot(parts: List<String?>): String = parts.filterNot { it.isNullOrBlank() }.joinToString(" · ")

    /** `18 Oct 2026` from a `YYYY-MM-DD` date; the text itself when it does not parse. */
    fun date(
        iso: String,
        locale: Locale = Locale.getDefault(),
    ): String =
        runCatching {
            java.time.LocalDate
                .parse(
                    iso.take(DATE_LENGTH),
                ).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))
        }.getOrDefault(iso)

    /** The date of an ISO 8601 instant in the clinic's time zone; null when it does not parse. */
    fun dateOfInstant(
        text: String,
        zone: String,
        locale: Locale = Locale.getDefault(),
    ): String? {
        val at = runCatching { Instant.parse(text) }.getOrNull() ?: return null
        val id = runCatching { ZoneId.of(zone) }.getOrDefault(ZoneId.systemDefault())
        return at
            .atZone(id)
            .toLocalDate()
            .toString()
            .let { date(it, locale) }
    }

    private const val DATE_LENGTH = 10
    private const val KB = 1024L
    private const val MB = 1024L * 1024L
}
