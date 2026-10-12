package com.aarogyam.staff.signin

import kotlin.jvm.JvmInline

/** The secret from an invitation link. Kept in memory only; never logged, stored or put in a URL. */
@JvmInline
value class InviteToken internal constructor(
    internal val value: String,
) {
    override fun toString(): String = "InviteToken(redacted)"
}

/** Reads invitation links: `https://<clinic host>/invite#<token>` from the email, or `aarogyam://invite#<token>`. */
object InviteLink {
    private val allowed = Regex("^[A-Za-z0-9_-]{16,256}$")

    /** The token in [text] (a link, possibly pasted with spaces around it), or null when it is not an invitation link. */
    fun parse(text: String): InviteToken? {
        val link = text.trim()
        val hash = link.indexOf('#')
        if (hash < 0) return null
        val head = link.substring(0, hash).trimEnd('/')
        val isInvite =
            head == "aarogyam://invite" ||
                (head.startsWith("https://") && head.substringAfter("https://").substringAfter('/', "") == "invite")
        val token = link.substring(hash + 1)
        return if (isInvite && allowed.matches(token)) InviteToken(token) else null
    }
}
