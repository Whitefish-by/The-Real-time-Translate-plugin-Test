import Foundation
import SafariServices

private enum SharedBridge {
    static let appGroup = "group.com.example.LiveBilingualSubtitles"
    static let commandKey = "pendingCommand"
    static let heartbeatKey = "hostHeartbeat"
    static let activeSessionKey = "activeSessionId"
    static let notification = CFNotificationName("com.example.LiveBilingualSubtitles.command" as CFString)
}

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        guard
            let item = context.inputItems.first as? NSExtensionItem,
            let userInfo = item.userInfo as? [String: Any],
            let message = userInfo[SFExtensionMessageKey] as? [String: Any]
        else {
            complete(context, response: ["accepted": false, "message": "Invalid native message"])
            return
        }

        let defaults = UserDefaults(suiteName: SharedBridge.appGroup)
        let hostHeartbeat = defaults?.object(forKey: SharedBridge.heartbeatKey) as? Date
        let hostRunning = hostHeartbeat.map { Date().timeIntervalSince($0) < 3 } ?? false
        let activeSessionId = defaults?.string(forKey: SharedBridge.activeSessionKey)

        if message["type"] as? String == "status" {
            var response: [String: Any] = ["accepted": true, "hostRunning": hostRunning]
            if let activeSessionId { response["activeSessionId"] = activeSessionId }
            complete(context, response: response)
            return
        }

        guard hostRunning else {
            complete(context, response: [
                "accepted": false,
                "hostRunning": false,
                "message": "Open the menu bar app first"
            ])
            return
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: message)
            defaults?.set(data, forKey: SharedBridge.commandKey)
            defaults?.synchronize()
            CFNotificationCenterPostNotification(
                CFNotificationCenterGetDarwinNotifyCenter(),
                SharedBridge.notification,
                nil,
                nil,
                true
            )
            complete(context, response: [
                "accepted": true,
                "hostRunning": true,
                "message": "Command delivered"
            ])
        } catch {
            complete(context, response: ["accepted": false, "hostRunning": hostRunning, "message": error.localizedDescription])
        }
    }

    private func complete(_ context: NSExtensionContext, response value: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: value]
        context.completeRequest(returningItems: [response])
    }
}
