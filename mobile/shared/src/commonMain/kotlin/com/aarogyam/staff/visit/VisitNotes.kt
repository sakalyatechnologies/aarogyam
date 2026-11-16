package com.aarogyam.staff.visit

import com.aarogyam.staff.api.model.NoteSections

/** What a bullet says, and so which SOAP section it lands in. */
enum class BulletKind {
    /** The patient's words: Subjective. */
    Complaint,

    /** What the clinician found: Objective. */
    Finding,

    /** What happens next: Plan. */
    Advice,

    /** Dictated text, Subjective until the person retags it. */
    Dictated,
}

/** One quick note bullet. */
data class Bullet(
    val id: Int,
    val kind: BulletKind,
    val text: String,
)

/** The note's sections from [bullets]: each section is its bullets as "• " lines, or null when empty. */
fun sectionsOf(bullets: List<Bullet>): NoteSections {
    fun lines(vararg kinds: BulletKind) =
        bullets
            .filter { it.kind in kinds && it.text.isNotBlank() }
            .joinToString("\n") { "• " + it.text.trim() }
            .ifEmpty { null }
    return NoteSections(
        subjective = lines(BulletKind.Complaint, BulletKind.Dictated),
        objective = lines(BulletKind.Finding),
        plan = lines(BulletKind.Advice),
    )
}

/**
 * The bullets of a saved note, the reverse of [sectionsOf]: each line of a section is one bullet,
 * its "• " dropped. Null when the note has an Assessment, which bullets cannot hold.
 */
fun bulletsOf(sections: NoteSections): List<Bullet>? {
    if (!sections.assessment.isNullOrBlank()) return null

    fun lines(text: String?) =
        text
            .orEmpty()
            .lines()
            .map { it.trim().removePrefix("•").trim() }
            .filter { it.isNotEmpty() }
    val kinded =
        lines(sections.subjective).map { BulletKind.Complaint to it } +
            lines(sections.objective).map { BulletKind.Finding to it } +
            lines(sections.plan).map { BulletKind.Advice to it }
    return kinded.mapIndexed { i, (kind, text) -> Bullet(i + 1, kind, text) }
}
