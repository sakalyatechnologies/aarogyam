package com.aarogyam.staff.device

import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DeviceTest {
    @Test
    fun memoryPreferencesStoreAndRemove() {
        val prefs = MemoryPreferences()
        assertNull(prefs.get(PreferenceKey.AvatarChoice))
        prefs.set(PreferenceKey.AvatarChoice, "d3")
        assertEquals("d3", prefs.get(PreferenceKey.AvatarChoice))
        prefs.set(PreferenceKey.AvatarChoice, null)
        assertNull(prefs.get(PreferenceKey.AvatarChoice))
    }

    @Test
    fun languagesRoundTripThroughTheirTags() {
        DictationLanguage.entries.forEach { assertEquals(it, DictationLanguage.fromTag(it.tag)) }
        assertNull(DictationLanguage.fromTag("gu-IN"))
        assertEquals(listOf("en-IN", "hi-IN", "mr-IN"), DictationLanguage.entries.map { it.tag })
    }

    @Test
    fun theNoneRecogniserIsUnavailable() {
        DictationLanguage.entries.forEach {
            assertEquals(
                DictationAvailability.Unavailable,
                Dictation.None.availability(it),
            )
        }
    }

    @Test
    fun theFakeEmitsWhatTestsSay() =
        runTest {
            val fake = FakeDictation()
            val seen = mutableListOf<DictationEvent>()
            val job = launch { fake.events.take(3).toList(seen) }
            yield()
            fake.start(DictationLanguage.Marathi)
            assertEquals(DictationLanguage.Marathi, fake.listening)
            fake.say("दात", "दात दुखतो")
            fake.stop()
            job.join()
            assertEquals(
                listOf(DictationEvent.Partial("दात"), DictationEvent.Final("दात दुखतो"), DictationEvent.Ended),
                seen,
            )
        }
}
