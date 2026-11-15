package com.aarogyam.staff.android.ui.visit

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import com.aarogyam.staff.device.Dictation
import com.aarogyam.staff.device.DictationAvailability
import com.aarogyam.staff.device.DictationEvent
import com.aarogyam.staff.device.DictationFailure
import com.aarogyam.staff.device.DictationLanguage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * The phone's speech recogniser as the shared [Dictation] (en-IN, hi-IN, mr-IN). The app passes one to
 * `AppGraph.create(dictation = ...)`. The screen asks for `RECORD_AUDIO` before it calls [start]; without
 * it a [DictationFailure.PermissionDenied] is reported. Audio is never kept here.
 */
class AndroidDictation(
    context: Context,
) : Dictation {
    private val app = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val mutable = MutableSharedFlow<DictationEvent>(extraBufferCapacity = BUFFER)
    private var recognizer: SpeechRecognizer? = null

    override val events: Flow<DictationEvent> = mutable.asSharedFlow()

    override fun availability(language: DictationLanguage): DictationAvailability =
        when {
            onDeviceAvailable() -> DictationAvailability.OnDevice
            SpeechRecognizer.isRecognitionAvailable(app) -> DictationAvailability.NetworkOnly
            else -> DictationAvailability.Unavailable
        }

    override fun start(language: DictationLanguage) {
        main.post {
            if (!hasPermission()) return@post fail(DictationFailure.PermissionDenied)
            if (!SpeechRecognizer.isRecognitionAvailable(app)) return@post fail(DictationFailure.NotAvailable)
            release()
            val made = SpeechRecognizer.createSpeechRecognizer(app)
            made.setRecognitionListener(listener)
            recognizer = made
            val intent =
                Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language.tag)
                    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            made.startListening(intent)
        }
    }

    override fun stop() {
        main.post { recognizer?.stopListening() }
    }

    private fun onDeviceAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && SpeechRecognizer.isOnDeviceRecognitionAvailable(app)

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun fail(reason: DictationFailure) = emit(DictationEvent.Failed(reason))

    private fun emit(event: DictationEvent) {
        mutable.tryEmit(event)
    }

    private fun release() {
        recognizer?.destroy()
        recognizer = null
    }

    private val listener =
        object : RecognitionListener {
            override fun onPartialResults(partialResults: Bundle?) {
                first(partialResults)?.let { emit(DictationEvent.Partial(it)) }
            }

            override fun onResults(results: Bundle?) {
                first(results)?.let { emit(DictationEvent.Final(it)) }
                emit(DictationEvent.Ended)
                release()
            }

            override fun onError(error: Int) {
                val reason =
                    when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> DictationFailure.PermissionDenied

                        SpeechRecognizer.ERROR_NETWORK,
                        SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                        -> DictationFailure.Network

                        SpeechRecognizer.ERROR_NO_MATCH,
                        SpeechRecognizer.ERROR_SPEECH_TIMEOUT,
                        -> DictationFailure.NoSpeech

                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> DictationFailure.Busy

                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED,
                        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
                        -> DictationFailure.NotAvailable

                        else -> DictationFailure.Other
                    }
                emit(DictationEvent.Failed(reason))
                release()
            }

            override fun onReadyForSpeech(params: Bundle?) = Unit

            override fun onBeginningOfSpeech() = Unit

            override fun onRmsChanged(rmsdB: Float) = Unit

            override fun onBufferReceived(buffer: ByteArray?) = Unit

            override fun onEndOfSpeech() = Unit

            override fun onEvent(
                eventType: Int,
                params: Bundle?,
            ) = Unit
        }

    private fun first(bundle: Bundle?): String? =
        bundle
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            ?.takeIf { it.isNotBlank() }

    private companion object {
        const val BUFFER = 64
    }
}
