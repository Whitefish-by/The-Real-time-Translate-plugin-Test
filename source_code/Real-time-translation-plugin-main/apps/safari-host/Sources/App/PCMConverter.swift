import AVFoundation
import CoreMedia
import Foundation

final class PCMConverter: @unchecked Sendable {
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 16_000,
        channels: 1,
        interleaved: false
    )!
    private var pendingSamples: [Int16] = []
    private var converter: AVAudioConverter?
    private var converterInputFormat: AVAudioFormat?
    private let lock = NSLock()

    func append(_ sampleBuffer: CMSampleBuffer) -> [Data] {
        guard sampleBuffer.isValid else { return [] }
        return (try? sampleBuffer.withAudioBufferList { audioBufferList, _ -> [Data] in
            guard
                let description = sampleBuffer.formatDescription?.audioStreamBasicDescription,
                let inputFormat = AVAudioFormat(
                    commonFormat: description.mFormatFlags & kAudioFormatFlagIsFloat != 0 ? .pcmFormatFloat32 : .pcmFormatInt16,
                    sampleRate: description.mSampleRate,
                    channels: description.mChannelsPerFrame,
                    interleaved: description.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
                ),
                let input = AVAudioPCMBuffer(pcmFormat: inputFormat, bufferListNoCopy: audioBufferList.unsafePointer)
            else { return [] }

            return append(input)
        }) ?? []
    }

    func append(_ input: AVAudioPCMBuffer) -> [Data] {
        lock.lock()
        defer { lock.unlock() }

        let inputFormat = input.format
        if converter == nil || !matchesConverterInput(inputFormat) {
            converter = AVAudioConverter(from: inputFormat, to: targetFormat)
            converterInputFormat = inputFormat
        }
        guard let converter else { return [] }

        let ratio = targetFormat.sampleRate / inputFormat.sampleRate
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * ratio)) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return [] }
        var consumed = false
        var conversionError: NSError?
        let status = converter.convert(to: output, error: &conversionError) { _, inputStatus in
            if consumed {
                inputStatus.pointee = .noDataNow
                return nil
            }
            consumed = true
            inputStatus.pointee = .haveData
            return input
        }
        guard status != .error, conversionError == nil, let samples = output.floatChannelData?[0] else { return [] }

        for index in 0..<Int(output.frameLength) {
            let value = max(-1, min(1, samples[index]))
            pendingSamples.append(value < 0 ? Int16(value * 32_768) : Int16(value * 32_767))
        }
        var frames: [Data] = []
        while pendingSamples.count >= 640 {
            var chunk = Array(pendingSamples.prefix(640))
            pendingSamples.removeFirst(640)
            frames.append(chunk.withUnsafeMutableBytes { Data($0) })
        }
        return frames
    }

    private func matchesConverterInput(_ format: AVAudioFormat) -> Bool {
        guard let converterInputFormat else { return false }
        return converterInputFormat.sampleRate == format.sampleRate
            && converterInputFormat.channelCount == format.channelCount
            && converterInputFormat.commonFormat == format.commonFormat
            && converterInputFormat.isInterleaved == format.isInterleaved
    }

    func reset() {
        lock.lock()
        pendingSamples.removeAll(keepingCapacity: true)
        converter?.reset()
        lock.unlock()
    }
}
