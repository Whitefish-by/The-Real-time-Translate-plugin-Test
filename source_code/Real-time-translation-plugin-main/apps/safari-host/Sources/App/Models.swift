import Foundation

struct ExtensionSettings: Codable, Sendable {
    let sourceLanguages: [String]
    let targetLanguage: String
    let displayMode: String
    let fontSizePx: Int
    let backgroundOpacity: Double
    let verticalOffset: Int
    let gatewayUrl: String
    let clientToken: String
}

struct StartCommand: Sendable {
    let sessionId: UUID
    let tabId: Int
    let settings: ExtensionSettings

    func nativeEventEnvelope(_ sourceEvent: [String: Any]) -> [String: Any] {
        var event = sourceEvent
        if event["sessionId"] == nil {
            event["sessionId"] = sessionId.uuidString.lowercased()
        }
        return ["payload": event, "tabId": tabId]
    }
}

struct AudioFrame: Sendable {
    let sequence: UInt32
    let audioEndMs: UInt32
    let pcm: Data

    var encoded: Data {
        var sequenceLE = sequence.littleEndian
        var audioEndLE = audioEndMs.littleEndian
        var result = Data(bytes: &sequenceLE, count: MemoryLayout<UInt32>.size)
        result.append(Data(bytes: &audioEndLE, count: MemoryLayout<UInt32>.size))
        result.append(pcm)
        return result
    }
}

enum HostState: Equatable, Sendable {
    case idle
    case selecting
    case connecting
    case capturing
    case reconnecting
    case error(String)

    var label: String {
        switch self {
        case .idle: return "尚未开始"
        case .selecting: return "请选择 Safari 窗口"
        case .connecting: return "正在连接字幕网关…"
        case .capturing: return "正在生成字幕"
        case .reconnecting: return "网络中断，正在重连…"
        case .error(let message): return message
        }
    }
}
