package com.aarogyam.staff.desk

/**
 * Why a walk-in's welcome message did not reach the patient, for the desk to say it in person.
 * Queued and sent are the normal path and show nothing.
 */
enum class WelcomeNote {
    Failed,
    NoConsent,
    OptedOut,
    NoAddress,

    /** Skipped for a reason the desk can't act on (the record changed, the channel isn't ready). */
    Skipped,
}

/**
 * Maps a token's `welcome_status` and `welcome_skip_reason` to a [WelcomeNote], or null when the
 * welcome is on its way, was sent, or didn't apply.
 */
fun welcomeNote(
    status: String?,
    skipReason: String?,
): WelcomeNote? =
    when (status) {
        "failed" -> {
            WelcomeNote.Failed
        }

        "skipped" -> {
            when (skipReason) {
                "no_consent", "consent_withdrawn" -> WelcomeNote.NoConsent
                "opted_out" -> WelcomeNote.OptedOut
                "no_address" -> WelcomeNote.NoAddress
                else -> WelcomeNote.Skipped
            }
        }

        else -> {
            null
        }
    }
