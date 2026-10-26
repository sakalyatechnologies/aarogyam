import AarogyamShared
import AVFoundation
import Foundation
import Speech

/// The shared `Dictation` interface on `SFSpeechRecognizer`: on the phone when the language
/// supports it, partial and final results as events, and the audio only ever lives in memory
/// buffers on their way to the recogniser (decision 7: never stored, never logged).
final class SpeechDictation: NSObject, Dictation {
    private let bus = DictationBus()
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var latest = ""
    private var active = false

    var events: SkieSwiftFlow<any DictationEvent> {
        SkieSwiftFlow<any DictationEvent>._unconditionallyBridgeFromObjectiveC(SkieKotlinFlow<AnyObject>(bus))
    }

    func availability(language: DictationLanguage) -> DictationAvailability {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language.tag)), recognizer.isAvailable else {
            return .unavailable
        }
        return recognizer.supportsOnDeviceRecognition ? .onDevice : .networkOnly
    }

    func start(language: DictationLanguage) {
        DispatchQueue.main.async { [self] in
            guard !active else { return bus.send(DictationEventFailed(reason: .busy)) }
            active = true
            SFSpeechRecognizer.requestAuthorization { [self] status in
                DispatchQueue.main.async {
                    guard status == .authorized else { return self.fail(.permissionDenied) }
                    AVAudioApplication.requestRecordPermission { granted in
                        DispatchQueue.main.async { granted ? self.listen(language) : self.fail(.permissionDenied) }
                    }
                }
            }
        }
    }

    func stop() {
        DispatchQueue.main.async { [self] in
            guard active else { return }
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
            request?.endAudio()
        }
    }

    private func listen(_ language: DictationLanguage) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language.tag)), recognizer.isAvailable else {
            return fail(.notAvailable)
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        self.request = request
        latest = ""
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let input = engine.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            engine.prepare()
            try engine.start()
        } catch {
            return fail(.other)
        }
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(result, error) }
        }
    }

    private func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?) {
        if let result {
            latest = result.bestTranscription.formattedString
            if result.isFinal { return finish(final: latest) }
            bus.send(DictationEventPartial(text: latest))
        }
        if error != nil { finish(final: latest) }
    }

    /// Ends the session: the last words become the final phrase, then listening is over.
    private func finish(final text: String) {
        guard active else { return }
        teardown()
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !words.isEmpty { bus.send(DictationEventFinal(text: words)) }
        bus.send(DictationEventEnded.shared)
    }

    private func fail(_ reason: DictationFailure) {
        teardown()
        bus.send(DictationEventFailed(reason: reason))
    }

    private func teardown() {
        active = false
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// A Kotlin `Flow` written in Swift: each collector gets every event, in order, until its
/// coroutine is cancelled (its next `emit` then throws and the collector is dropped).
final class DictationBus: NSObject, Kotlinx_coroutines_coreFlow {
    private let lock = NSLock()
    private var listeners: [UUID: AsyncStream<DictationEvent>.Continuation] = [:]

    func send(_ event: DictationEvent) {
        lock.lock()
        let all = Array(listeners.values)
        lock.unlock()
        all.forEach { $0.yield(event) }
    }

    func __collect(collector: any Kotlinx_coroutines_coreFlowCollector) async throws {
        let id = UUID()
        let (stream, continuation) = AsyncStream.makeStream(of: DictationEvent.self)
        add(id, continuation)
        defer { remove(id) }
        for await event in stream { try await collector.emit(value: event) }
    }

    private func add(_ id: UUID, _ continuation: AsyncStream<DictationEvent>.Continuation) {
        lock.lock()
        defer { lock.unlock() }
        listeners[id] = continuation
    }

    private func remove(_ id: UUID) {
        lock.lock()
        defer { lock.unlock() }
        listeners[id] = nil
    }
}
