import Foundation

@MainActor
final class CommandMailbox {
    static let appGroup = "group.com.example.LiveBilingualSubtitles"
    private static let commandKey = "pendingCommand"
    private static let heartbeatKey = "hostHeartbeat"
    private static let activeSessionKey = "activeSessionId"
    private static let notification = CFNotificationName("com.example.LiveBilingualSubtitles.command" as CFString)

    private let defaults = UserDefaults(suiteName: appGroup)
    private let handler: @MainActor ([String: Any]) -> Void
    private var heartbeatTimer: Timer?

    init(handler: @escaping @MainActor ([String: Any]) -> Void) {
        self.handler = handler
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                let mailbox = Unmanaged<CommandMailbox>.fromOpaque(observer).takeUnretainedValue()
                Task { @MainActor in mailbox.consume() }
            },
            Self.notification.rawValue,
            nil,
            .deliverImmediately
        )
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.writeHeartbeat() }
        }
        writeHeartbeat()
        consume()
    }

    deinit {
        CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), nil, nil)
        heartbeatTimer?.invalidate()
    }

    private func writeHeartbeat() {
        defaults?.set(Date(), forKey: Self.heartbeatKey)
    }

    func setActiveSession(_ sessionId: UUID?) {
        if let sessionId {
            defaults?.set(sessionId.uuidString.lowercased(), forKey: Self.activeSessionKey)
        } else {
            defaults?.removeObject(forKey: Self.activeSessionKey)
        }
    }

    private func consume() {
        guard let data = defaults?.data(forKey: Self.commandKey) else { return }
        defaults?.removeObject(forKey: Self.commandKey)
        guard let object = Self.decodeCommand(data) else { return }
        handler(object)
    }

    static func decodeCommand(_ data: Data) -> [String: Any]? {
        try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}
