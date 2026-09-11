import CoreMedia
import Foundation
import ScreenCaptureKit

@MainActor
protocol ScreenAudioCaptureDelegate: AnyObject {
    func screenAudioCaptureDidStart(_ capture: ScreenAudioCapture)
    func screenAudioCapture(_ capture: ScreenAudioCapture, didProduce pcm: Data)
    func screenAudioCapture(_ capture: ScreenAudioCapture, didFail error: Error)
    func screenAudioCaptureDidStop(_ capture: ScreenAudioCapture)
}

@MainActor
final class ScreenAudioCapture: NSObject {
    weak var delegate: ScreenAudioCaptureDelegate?
    private let picker = SCContentSharingPicker.shared
    private let output = StreamOutput()
    private var stream: SCStream?
    private var previousFilter: SCContentFilter?

    override init() {
        super.init()
        output.onPCM = { [weak self] pcm in
            Task { @MainActor in
                guard let self else { return }
                self.delegate?.screenAudioCapture(self, didProduce: pcm)
            }
        }
        output.onError = { [weak self] error in
            Task { @MainActor in
                guard let self else { return }
                self.delegate?.screenAudioCapture(self, didFail: error)
            }
        }
        picker.add(self)
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = [.singleWindow, .singleApplication]
        configuration.excludedBundleIDs = [Bundle.main.bundleIdentifier].compactMap { $0 }
        configuration.allowsChangingSelectedContent = true
        picker.defaultConfiguration = configuration
        picker.isActive = true
    }

    deinit {
        picker.remove(self)
    }

    func requestSelection() {
        if let previousFilter {
            Task { await start(filter: previousFilter) }
            return
        }
        picker.present(using: .window)
    }

    func requestNewSelection() {
        previousFilter = nil
        picker.present(using: .window)
    }

    func stop() async {
        guard let stream else { return }
        self.stream = nil
        try? await stream.stopCapture()
        output.reset()
    }

    private func start(filter: SCContentFilter) async {
        await stop()
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.excludesCurrentProcessAudio = true
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        do {
            try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: output.queue)
            try await stream.startCapture()
            self.stream = stream
            previousFilter = filter
            delegate?.screenAudioCaptureDidStart(self)
        } catch {
            previousFilter = nil
            delegate?.screenAudioCapture(self, didFail: error)
        }
    }
}

extension ScreenAudioCapture: SCContentSharingPickerObserver {
    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        guard stream == nil else { return }
        Task { @MainActor in self.delegate?.screenAudioCaptureDidStop(self) }
    }

    nonisolated func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        Task { @MainActor in await self.start(filter: filter) }
    }

    nonisolated func contentSharingPickerStartDidFailWithError(_ error: any Error) {
        Task { @MainActor in self.delegate?.screenAudioCapture(self, didFail: error) }
    }
}

private final class StreamOutput: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "LiveBilingualSubtitles.ScreenAudio", qos: .userInteractive)
    var onPCM: (@Sendable (Data) -> Void)?
    var onError: (@Sendable (Error) -> Void)?
    private let converter = PCMConverter()

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        for frame in converter.append(sampleBuffer) { onPCM?(frame) }
    }

    func stream(_ stream: SCStream, didStopWithError error: any Error) {
        onError?(error)
    }

    func reset() { converter.reset() }
}
