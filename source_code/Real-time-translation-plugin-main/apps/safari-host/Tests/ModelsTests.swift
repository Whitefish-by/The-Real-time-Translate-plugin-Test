import XCTest
import AVFoundation
@testable import LiveBilingualSubtitles

final class ModelsTests: XCTestCase {
    func testAudioFrameUsesLittleEndianHeader() {
        let frame = AudioFrame(sequence: 0x01020304, audioEndMs: 800, pcm: Data([0xAA, 0xBB]))
        XCTAssertEqual(Array(frame.encoded.prefix(10)), [0x04, 0x03, 0x02, 0x01, 0x20, 0x03, 0x00, 0x00, 0xAA, 0xBB])
    }

    func testSettingsDecodeFromExtensionShape() throws {
        let json = #"{"sourceLanguages":["zh-CN","en-US"],"targetLanguage":"zh-Hans","displayMode":"bilingual","fontSizePx":24,"backgroundOpacity":0.72,"verticalOffset":42,"gatewayUrl":"ws://127.0.0.1:8787/v1/realtime","clientToken":"change-me"}"#
        let value = try JSONDecoder().decode(ExtensionSettings.self, from: Data(json.utf8))
        XCTAssertEqual(value.sourceLanguages, ["zh-CN", "en-US"])
        XCTAssertEqual(value.targetLanguage, "zh-Hans")
    }

    func testPCMConverterProducesFortyMillisecondMonoFrames() throws {
        let format = try XCTUnwrap(AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 48_000,
            channels: 2,
            interleaved: false
        ))
        let input = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4_800))
        input.frameLength = 4_800
        for channel in 0..<2 {
            let samples = try XCTUnwrap(input.floatChannelData?[channel])
            for index in 0..<4_800 { samples[index] = 0.25 }
        }

        let frames = PCMConverter().append(input)
        XCTAssertGreaterThanOrEqual(frames.count, 2)
        XCTAssertTrue(frames.allSatisfy { $0.count == 1_280 })
        let firstSample = frames[0].withUnsafeBytes { $0.load(as: Int16.self) }
        XCTAssertEqual(Int(firstSample), 8_192, accuracy: 256)
    }

    func testNativeEventEnvelopeRoutesToTheStartingTabAndSession() throws {
        let settings = ExtensionSettings(
            sourceLanguages: ["zh-CN", "en-US"],
            targetLanguage: "zh-Hans",
            displayMode: "bilingual",
            fontSizePx: 24,
            backgroundOpacity: 0.72,
            verticalOffset: 42,
            gatewayUrl: "ws://127.0.0.1:8787/v1/realtime",
            clientToken: "change-me"
        )
        let sessionId = try XCTUnwrap(UUID(uuidString: "00000000-0000-4000-8000-000000000000"))
        let envelope = StartCommand(sessionId: sessionId, tabId: 17, settings: settings)
            .nativeEventEnvelope(["type": "status", "code": "reconnecting"])
        XCTAssertEqual(envelope["tabId"] as? Int, 17)
        let payload = try XCTUnwrap(envelope["payload"] as? [String: Any])
        XCTAssertEqual(payload["sessionId"] as? String, sessionId.uuidString.lowercased())
    }

    func testCommandMailboxDecodesAppGroupPayload() throws {
        let data = try JSONSerialization.data(withJSONObject: ["type": "stop", "sessionId": "session"])
        let decoded = try XCTUnwrap(CommandMailbox.decodeCommand(data))
        XCTAssertEqual(decoded["type"] as? String, "stop")
        XCTAssertNil(CommandMailbox.decodeCommand(Data("not-json".utf8)))
    }
}
