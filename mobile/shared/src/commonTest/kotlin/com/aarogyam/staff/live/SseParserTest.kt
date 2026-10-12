package com.aarogyam.staff.live

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SseParserTest {
    private val bom = Char(0xFEFF).toString()

    private fun parse(
        text: String,
        parser: SseParser = SseParser(),
    ): List<SseFrame> = text.split("\n").mapNotNull { parser.feed(it) }

    @Test
    fun event_and_data_dispatch_on_the_blank_line() {
        val frames = parse("event: queue.changed\ndata: {\"kind\":\"queue\"}\n\n")
        assertEquals(listOf(SseFrame("queue.changed", "{\"kind\":\"queue\"}", null)), frames)
    }

    @Test
    fun nothing_dispatches_before_the_blank_line() {
        val parser = SseParser()
        assertNull(parser.feed("event: visit.changed"))
        assertNull(parser.feed("data: {}"))
        assertEquals("visit.changed", parser.feed("")?.event)
    }

    @Test
    fun the_event_name_defaults_to_message() {
        assertEquals(listOf(SseFrame("message", "hi", null)), parse("data: hi\n\n"))
    }

    @Test
    fun multi_line_data_is_joined_with_newlines() {
        assertEquals("a\nb\n\nd", parse("data: a\ndata: b\ndata:\ndata: d\n\n").single().data)
    }

    @Test
    fun only_one_space_after_the_colon_is_dropped() {
        assertEquals("  two", parse("data:   two\n\n").single().data)
        assertEquals("none", parse("data:none\n\n").single().data)
    }

    @Test
    fun comment_lines_and_heartbeats_are_ignored_and_dispatch_nothing() {
        assertEquals(emptyList(), parse(": hb\n\n: another\n"))
        assertEquals("x", parse(": hb\ndata: x\n: mid\n\n").single().data)
    }

    @Test
    fun a_blank_line_with_nothing_pending_dispatches_nothing() {
        assertEquals(emptyList(), parse("\n\n\n"))
    }

    @Test
    fun an_event_with_no_data_still_dispatches_so_a_bare_reset_works() {
        assertEquals(listOf(SseFrame("reset", "", null)), parse("event: reset\n\n"))
    }

    @Test
    fun the_event_name_does_not_leak_into_the_next_frame() {
        val frames = parse("event: a\ndata: 1\n\ndata: 2\n\n")
        assertEquals(listOf("a", "message"), frames.map { it.event })
        assertEquals(listOf("1", "2"), frames.map { it.data })
    }

    @Test
    fun the_id_is_remembered_across_frames_and_reported() {
        val parser = SseParser()
        val frames = parse("id: 41\nevent: a\ndata: 1\n\nevent: b\ndata: 2\n\nid: 43\ndata: 3\n\n", parser)
        assertEquals(listOf("41", "41", "43"), frames.map { it.id })
        assertEquals("43", parser.lastEventId)
    }

    @Test
    fun an_id_on_its_own_still_updates_the_last_id() {
        val parser = SseParser()
        parse("id: 9\n\n", parser)
        assertEquals("9", parser.lastEventId)
    }

    @Test
    fun an_empty_id_resets_and_an_id_with_nul_is_ignored() {
        val parser = SseParser("5")
        parser.feed("id: 6\u0000")
        assertEquals("5", parser.lastEventId)
        parser.feed("id")
        assertEquals("", parser.lastEventId)
    }

    @Test
    fun the_initial_id_is_reported_until_the_server_sends_one() {
        assertEquals("12", parse("data: x\n\n", SseParser("12")).single().id)
    }

    @Test
    fun a_field_without_a_colon_has_an_empty_value() {
        assertEquals(listOf(SseFrame("message", "\nx", null)), parse("data\ndata: x\n\n"))
    }

    @Test
    fun unknown_fields_and_retry_are_ignored() {
        assertEquals(emptyList(), parse("retry: 1000\nfoo: bar\n\n"))
    }

    @Test
    fun carriage_returns_and_a_leading_bom_are_tolerated() {
        val parser = SseParser()
        assertNull(parser.feed(bom + "event: x\r"))
        assertNull(parser.feed("data: y\r"))
        assertEquals(SseFrame("x", "y", null), parser.feed("\r"))
    }

    @Test
    fun an_unfinished_frame_is_never_dispatched() {
        assertEquals(emptyList(), parse("event: a\ndata: partial"))
    }

    @Test
    fun a_colon_inside_the_value_is_kept() {
        assertEquals("a:b:c", parse("data: a:b:c\n\n").single().data)
    }
}
