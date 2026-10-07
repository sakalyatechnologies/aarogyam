package com.aarogyam.staff.richtext

/** A run of formatted text. */
sealed interface Inline {
    data class Text(
        val text: String,
    ) : Inline

    data class Bold(
        val children: List<Inline>,
    ) : Inline

    data class Italic(
        val children: List<Inline>,
    ) : Inline

    data object Break : Inline
}

/** A block of formatted text. */
sealed interface Block {
    data class Heading(
        val level: Int,
        val children: List<Inline>,
    ) : Block

    data class Paragraph(
        val children: List<Inline>,
    ) : Block

    data class Bullets(
        val items: List<List<Inline>>,
    ) : Block

    data class Numbers(
        val items: List<List<Inline>>,
    ) : Block
}

/**
 * The strict Markdown subset clinical text is stored in: headings (`#` to `###`), bullet and numbered
 * lists, `**bold**` and `*italic*` (or `_italic_`). Anything else is literal text. Same rules as the
 * API (`aarogyam-domain/src/richtext.rs`) and the portal; the parser yields a small tree the UI draws
 * with its own text styles, so nothing is ever interpreted as HTML.
 */
object RichText {
    private val heading = Regex("^(#{1,3})\\s+(\\S.*)$")
    private val bullet = Regex("^[-*]\\s+(\\S.*)$")
    private val number = Regex("^\\d{1,3}[.)]\\s+(\\S.*)$")
    private val html = Regex("<[A-Za-z/!?]")
    private val deepHeading = Regex("^\\s*#{4,}\\s", RegexOption.MULTILINE)

    /** Parses stored text into blocks. */
    fun parse(source: String): List<Block> {
        val blocks = mutableListOf<Block>()
        var paragraph = mutableListOf<String>()

        fun endParagraph() {
            if (paragraph.isEmpty()) return
            val children = mutableListOf<Inline>()
            paragraph.forEachIndexed { index, line ->
                if (index > 0) children += Inline.Break
                children += parseInline(line)
            }
            blocks += Block.Paragraph(children)
            paragraph = mutableListOf()
        }
        for (raw in source.replace("\r\n", "\n").replace('\r', '\n').split('\n')) {
            val line = raw.trim()
            val headingMatch = heading.find(line)
            val bulletMatch = bullet.find(line)
            val numberMatch = number.find(line)
            when {
                line.isEmpty() -> {
                    endParagraph()
                }

                headingMatch != null -> {
                    endParagraph()
                    blocks +=
                        Block.Heading(headingMatch.groupValues[1].length, parseInline(headingMatch.groupValues[2]))
                }

                bulletMatch != null || numberMatch != null -> {
                    endParagraph()
                    val item = parseInline((bulletMatch ?: numberMatch)?.groupValues?.get(1).orEmpty())
                    val last = blocks.lastOrNull()
                    if (bulletMatch != null && last is Block.Bullets) {
                        blocks[blocks.lastIndex] = Block.Bullets(last.items + listOf(item))
                    } else if (bulletMatch == null && last is Block.Numbers) {
                        blocks[blocks.lastIndex] = Block.Numbers(last.items + listOf(item))
                    } else {
                        blocks += if (bulletMatch != null) Block.Bullets(listOf(item)) else Block.Numbers(listOf(item))
                    }
                }

                else -> {
                    paragraph += line
                }
            }
        }
        endParagraph()
        return blocks
    }

    /** Parses one line into text, bold and italic runs; unmatched markers stay as text. */
    fun parseInline(source: String): List<Inline> {
        val out = mutableListOf<Inline>()
        val text = StringBuilder()

        fun flush() {
            if (text.isNotEmpty()) {
                out += Inline.Text(text.toString())
                text.clear()
            }
        }
        var i = 0
        while (i < source.length) {
            val char = source[i]
            val next = source.getOrNull(i + 1)
            if (char == '*' && next == '*') {
                val close = source.indexOf("**", i + 2)
                if (close > i + 2) {
                    flush()
                    out += Inline.Bold(parseInline(source.substring(i + 2, close)))
                    i = close + 2
                    continue
                }
            }
            if (char == '*' && next != null && next != ' ' && next != '*') {
                val close = source.indexOf('*', i + 1)
                if (close > i + 1 && source[close - 1] != ' ' && source.getOrNull(close + 1) != '*') {
                    flush()
                    out += Inline.Italic(parseInline(source.substring(i + 1, close)))
                    i = close + 1
                    continue
                }
            }
            if (char == '_' && !isWord(source.getOrNull(i - 1)) && next != null && next != ' ') {
                var close = source.indexOf('_', i + 1)
                while (close != -1 && isWord(source.getOrNull(close + 1))) close = source.indexOf('_', close + 1)
                if (close > i + 1 && source[close - 1] != ' ') {
                    flush()
                    out += Inline.Italic(parseInline(source.substring(i + 1, close)))
                    i = close + 1
                    continue
                }
            }
            text.append(char)
            i += 1
        }
        flush()
        return out
    }

    private fun isWord(char: Char?): Boolean = char != null && char.isLetterOrDigit()

    /** Why the API would refuse [text], or null when it is within the subset. */
    fun problem(text: String): RichTextProblem? =
        when {
            html.containsMatchIn(text) -> RichTextProblem.Html
            text.contains("![") || text.contains("](") -> RichTextProblem.LinkOrImage
            text.contains('`') -> RichTextProblem.Code
            deepHeading.containsMatchIn(text) -> RichTextProblem.DeepHeading
            else -> null
        }
}

/** What is outside the subset; the UI words each in its own language. */
enum class RichTextProblem { Html, LinkOrImage, Code, DeepHeading }

/** A toolbar action. */
enum class Format { Heading, Bold, Italic, Bullets, Numbers }

/** New text and the selection (`start` to `end`) it leaves. */
data class Formatted(
    val value: String,
    val start: Int,
    val end: Int,
)

/** Applies a toolbar action to the selection `start` to `end` (or the lines it touches). */
fun applyFormat(
    value: String,
    start: Int,
    end: Int,
    format: Format,
): Formatted {
    val from = start.coerceIn(0, value.length)
    val to = end.coerceIn(from, value.length)
    return when (format) {
        Format.Bold -> wrap(value, from, to, "**")
        Format.Italic -> wrap(value, from, to, "*")
        else -> formatLines(value, from, to, format)
    }
}

private fun wrap(
    value: String,
    start: Int,
    end: Int,
    mark: String,
): Formatted {
    val wrapped =
        start >= mark.length &&
            value.substring(start - mark.length, start) == mark &&
            value.substring(end).startsWith(mark)
    return if (wrapped) {
        Formatted(
            value.substring(0, start - mark.length) + value.substring(start, end) + value.substring(end + mark.length),
            start - mark.length,
            end - mark.length,
        )
    } else {
        Formatted(
            value.substring(0, start) + mark + value.substring(start, end) + mark + value.substring(end),
            start + mark.length,
            end + mark.length,
        )
    }
}

private val anyHeading = Regex("^#{1,6}\\s+")
private val levelTwo = Regex("^##\\s+")
private val listPrefix = Regex("^([-*]|\\d{1,3}[.)])\\s+")
private val bulletPrefix = Regex("^[-*]\\s+")
private val numberPrefix = Regex("^\\d{1,3}[.)]\\s+")

private fun formatLines(
    value: String,
    start: Int,
    end: Int,
    format: Format,
): Formatted {
    val lineStart = value.lastIndexOf('\n', start - 1) + 1
    val nextBreak = value.indexOf('\n', end)
    val lineEnd = if (nextBreak == -1) value.length else nextBreak
    val lines = value.substring(lineStart, lineEnd).split('\n')
    val changed =
        when (format) {
            Format.Heading -> {
                lines.map {
                    if (levelTwo.containsMatchIn(it)) {
                        it.replace(levelTwo, "")
                    } else {
                        "## " +
                            it.replace(anyHeading, "")
                    }
                }
            }

            else -> {
                val marker = if (format == Format.Bullets) bulletPrefix else numberPrefix
                val every = lines.all { marker.containsMatchIn(it) }
                lines.mapIndexed { index, line ->
                    val bare = line.replace(listPrefix, "")
                    when {
                        every -> bare
                        format == Format.Bullets -> "- $bare"
                        else -> "${index + 1}. $bare"
                    }
                }
            }
        }
    val replaced = changed.joinToString("\n")
    return Formatted(
        value.substring(0, lineStart) + replaced + value.substring(lineEnd),
        lineStart,
        lineStart + replaced.length,
    )
}
