package com.aarogyam.staff.chart

import com.aarogyam.staff.ScreenError
import com.aarogyam.staff.patients.ClinicMoment

/**
 * A chart finding, in the legend's order. [wholeTooth] findings cover the tooth and are never
 * recorded on one surface (the API refuses it).
 */
enum class Finding(
    internal val wire: String,
    val wholeTooth: Boolean,
) {
    Sound("sound", false),
    Caries("caries", false),
    Filled("filled", false),
    Crown("crown", true),
    RootCanal("root_canal", true),
    Missing("missing", true),
    Implant("implant", true),
    Bridge("bridge", true),
    Fractured("fractured", false),
    Watch("watch", false),
    ;

    /** Whether it supersedes the tooth's surface entries too (as the API applies it). */
    internal val clearsSurfaces: Boolean get() = this == Crown || this == Implant || this == Missing

    companion object {
        internal fun of(wire: String): Finding? = entries.firstOrNull { it.wire == wire }
    }
}

/** A tooth surface as the API names it: mesial, occlusal (incisal), distal, buccal (facial), lingual (palatal). */
enum class Surface {
    M,
    D,
    O,
    B,
    L,
    ;

    companion object {
        internal fun of(wire: String?): Surface? = entries.firstOrNull { it.name == wire }
    }
}

/** What a surface is called on a given tooth; each platform maps it to copy. */
enum class SurfaceName { Mesial, Distal, Occlusal, Incisal, Buccal, Facial, Lingual, Palatal }

enum class ToothKind { Incisor, Canine, Premolar, Molar }

/** Permanent (adult) or primary (child) teeth; the arches list teeth left to right as the clinician faces the patient. */
enum class Dentition(
    val upper: List<Int>,
    val lower: List<Int>,
) {
    Adult(
        listOf(18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28),
        listOf(48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38),
    ),
    Child(
        listOf(55, 54, 53, 52, 51, 61, 62, 63, 64, 65),
        listOf(85, 84, 83, 82, 81, 71, 72, 73, 74, 75),
    ),
    ;

    /** Every tooth of the dentition. */
    val teeth: List<Int> get() = upper + lower

    companion object {
        /** The dentition [tooth] belongs to, or null for a number that is not an FDI tooth. */
        fun of(tooth: Int): Dentition? = entries.firstOrNull { tooth in it.upper || tooth in it.lower }
    }
}

/** A finding on the whole tooth ([surface] null) or on one surface. */
data class SurfaceFinding(
    val surface: Surface?,
    val finding: Finding,
)

/** One tooth as the chart draws it. Teeth without entries are sound. [pending] marks an unsaved change. */
data class ToothView(
    val number: Int,
    val whole: Finding? = null,
    private val surfaces: Map<Surface, Finding> = emptyMap(),
    val pending: Boolean = false,
) {
    val primary: Boolean get() = number / 10 >= PRIMARY_QUADRANT
    val upper: Boolean get() = (number / 10) in UPPER_QUADRANTS
    val kind: ToothKind
        get() =
            when (val position = number % 10) {
                1, 2 -> ToothKind.Incisor
                3 -> ToothKind.Canine
                else -> if (primary || position > PREMOLAR_LAST) ToothKind.Molar else ToothKind.Premolar
            }

    /** The patient's right is drawn on the left, so those teeth's mesial side faces right, towards the midline. */
    val mesialFacesRight: Boolean get() = (number / 10) in RIGHT_QUADRANTS

    /** The finding on [surface], or null when nothing is recorded there. */
    fun finding(surface: Surface): Finding? = surfaces[surface]

    /** The tooth's current findings: whole tooth first, then surfaces in [Surface] order. */
    val findings: List<SurfaceFinding>
        get() =
            listOfNotNull(whole?.let { SurfaceFinding(null, it) }) +
                Surface.entries.mapNotNull { s -> surfaces[s]?.let { SurfaceFinding(s, it) } }

    /** The most telling finding: a whole-tooth one first, then the worst surface. */
    val headline: Finding
        get() {
            if (whole != null && whole != Finding.Sound) return whole
            val found = surfaces.values
            return SURFACE_SEVERITY.firstOrNull { it in found } ?: Finding.Sound
        }

    /** Whether the tooth has any finding other than sound (the "need care" count). */
    val needsCare: Boolean get() = headline != Finding.Sound

    fun surfaceName(surface: Surface): SurfaceName {
        val anterior = kind == ToothKind.Incisor || kind == ToothKind.Canine
        return when (surface) {
            Surface.M -> SurfaceName.Mesial
            Surface.D -> SurfaceName.Distal
            Surface.O -> if (anterior) SurfaceName.Incisal else SurfaceName.Occlusal
            Surface.B -> if (anterior) SurfaceName.Facial else SurfaceName.Buccal
            Surface.L -> if (upper) SurfaceName.Palatal else SurfaceName.Lingual
        }
    }

    /** The tooth after recording [finding] on [surface], as the server applies it. */
    internal fun with(
        finding: Finding,
        surface: Surface?,
    ): ToothView =
        when {
            surface != null -> copy(surfaces = surfaces + (surface to finding))
            finding.clearsSurfaces -> copy(whole = finding, surfaces = emptyMap())
            else -> copy(whole = finding)
        }

    internal companion object {
        const val PRIMARY_QUADRANT = 5
        const val PREMOLAR_LAST = 5
        val UPPER_QUADRANTS = setOf(1, 2, 5, 6)
        val RIGHT_QUADRANTS = setOf(1, 4, 5, 8)
        val SURFACE_SEVERITY = listOf(Finding.Caries, Finding.Fractured, Finding.Watch, Finding.Filled)
    }
}

enum class EntryStatus { Current, Superseded, EnteredInError }

/** Which list a dental term belongs to. */
enum class TermKind(
    internal val wire: String,
) {
    Procedure("procedure"),
    Material("material"),
    ;

    companion object {
        internal fun of(wire: String): TermKind? = entries.firstOrNull { it.wire == wire }
    }
}

/** A procedure or material: seeded (`zirconia`) or added by the clinic ([own], a UUID id). */
data class TermView(
    val id: String,
    val kind: TermKind,
    val label: String,
    val own: Boolean,
)

/**
 * Terms of [kind] matching [text], filtered on the phone (the list arrives with the chart, so
 * nothing is asked per keystroke): labels starting with it first ("Z" offers Zirconia), then
 * labels with a word starting with it, then labels containing it; ties keep the list's order.
 */
fun matchTerms(
    terms: List<TermView>,
    kind: TermKind,
    text: String,
): List<TermView> {
    val wanted = text.trim().lowercase()
    val ofKind = terms.filter { it.kind == kind }
    if (wanted.isEmpty()) return ofKind

    fun rank(label: String): Int {
        val folded = label.lowercase()
        return when {
            folded.startsWith(wanted) -> 0
            folded.split(WORD_BREAK).any { it.startsWith(wanted) } -> 1
            wanted in folded -> 2
            else -> NO_MATCH
        }
    }
    return ofKind
        .map { it to rank(it.label) }
        .filter { it.second < NO_MATCH }
        .sortedBy { it.second }
        .map { it.first }
}

/** Whether a term of [kind] already has this label (ignoring case and spacing): then "Add new" is not offered. */
fun hasLabel(
    terms: List<TermView>,
    kind: TermKind,
    text: String,
): Boolean {
    val wanted =
        text
            .trim()
            .split(SPACES)
            .joinToString(" ")
            .lowercase()
    return terms.any { it.kind == kind && it.label.lowercase() == wanted }
}

private val WORD_BREAK = Regex("[\\s(/.-]+")
private val SPACES = Regex("\\s+")
private const val NO_MATCH = 3

/** One entry of a tooth's history; [at] is in the clinic's time zone. */
data class HistoryEntryView(
    val id: String,
    val finding: Finding,
    val surface: Surface?,
    val status: EntryStatus,
    val at: ClinicMoment?,
    val note: String?,
    /** The procedure's label, if recorded. */
    val procedure: String? = null,
    /** The material's label, if recorded. */
    val material: String? = null,
)

/** The selected tooth's full history, fetched when the tooth is picked. */
sealed interface HistoryState {
    data object Loading : HistoryState

    data class Failed(
        val error: ScreenError,
    ) : HistoryState

    data class Loaded(
        /** Newest first. */
        val entries: List<HistoryEntryView>,
    ) : HistoryState
}

/** The picked tooth, the surface the person is looking at (null for the whole tooth) and its history. */
data class ToothSelection(
    val tooth: ToothView,
    val surface: Surface?,
    val history: HistoryState,
)
