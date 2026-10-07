package com.aarogyam.staff.richtext

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RichTextTest {
    @Test
    fun parses_headings_lists_bold_and_italic() {
        val blocks = RichText.parse("## Plan\n- **RCT** on 36\n- *review* soon\n\n1. First\n2. Second\n\nPlain line")
        assertEquals(4, blocks.size)
        assertEquals(Block.Heading(2, listOf(Inline.Text("Plan"))), blocks[0])
        val bullets = blocks[1] as Block.Bullets
        assertEquals(2, bullets.items.size)
        assertEquals(Inline.Bold(listOf(Inline.Text("RCT"))), bullets.items[0].first())
        assertEquals(Inline.Italic(listOf(Inline.Text("review"))), bullets.items[1].first())
        assertEquals(2, (blocks[2] as Block.Numbers).items.size)
        assertEquals(Block.Paragraph(listOf(Inline.Text("Plain line"))), blocks[3])
    }

    @Test
    fun markup_typed_into_a_note_stays_literal_text() {
        val hostile = "<script>alert(1)</script> [x](javascript:alert(2)) #### deep"
        val blocks = RichText.parse(hostile)
        val paragraph = blocks.single() as Block.Paragraph
        assertEquals(listOf<Inline>(Inline.Text(hostile)), paragraph.children)
    }

    @Test
    fun unmatched_markers_and_snake_case_are_text() {
        val paragraph = RichText.parse("2 * 3 = 6 and a_b_c and **open").single() as Block.Paragraph
        assertEquals(listOf<Inline>(Inline.Text("2 * 3 = 6 and a_b_c and **open")), paragraph.children)
    }

    @Test
    fun refuses_what_the_api_refuses() {
        assertNull(RichText.problem("## Plan\n- **RCT**\nBP < 120 and x<3"))
        assertEquals(RichTextProblem.Html, RichText.problem("<b>x</b>"))
        assertEquals(RichTextProblem.Html, RichText.problem("<!-- c -->"))
        assertEquals(RichTextProblem.LinkOrImage, RichText.problem("[x](http://e)"))
        assertEquals(RichTextProblem.LinkOrImage, RichText.problem("![x](http://e)"))
        assertEquals(RichTextProblem.Code, RichText.problem("`code`"))
        assertEquals(RichTextProblem.DeepHeading, RichText.problem("#### deep"))
    }

    @Test
    fun toolbar_wraps_and_unwraps_a_selection() {
        val bold = applyFormat("take rest now", 5, 9, Format.Bold)
        assertEquals(Formatted("take **rest** now", 7, 11), bold)
        assertEquals("take rest now", applyFormat(bold.value, bold.start, bold.end, Format.Bold).value)
        assertEquals("a *b* c", applyFormat("a b c", 2, 3, Format.Italic).value)
    }

    @Test
    fun toolbar_turns_lines_into_lists_and_toggles_headings() {
        val list = applyFormat("one\ntwo", 0, 7, Format.Numbers)
        assertEquals("1. one\n2. two", list.value)
        assertEquals("one\ntwo", applyFormat(list.value, list.start, list.end, Format.Numbers).value)
        assertEquals("## Plan", applyFormat("Plan", 0, 0, Format.Heading).value)
        assertEquals("Plan", applyFormat("## Plan", 0, 0, Format.Heading).value)
        assertEquals("a\n- b", applyFormat("a\nb", 2, 3, Format.Bullets).value)
    }
}
