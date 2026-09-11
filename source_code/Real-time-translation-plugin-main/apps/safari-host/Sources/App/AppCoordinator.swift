import Foundation
import SafariServices
import ServiceManagement

@MainActor
final class AppCoordinator: ObservableObject {
    static let extensionBundleIdentifier = "com.example.LiveBilingualSubtitles.Extension"

    @Published private(set) var state: HostState = .idle
    @Published var launchAtLogin = SMAppService.mainApp.status == .enabled

    private let capture = ScreenAudioCapture()
    private var socket: RealtimeSocket?
    private var mailbox: CommandMailbox!
    private var activeCommand: StartCommand?
    private var sequence: UInt32 = 0
    private var audioEndMs: UInt32 = 0

    init() {
        capture.delegate = self
        mailbox = CommandMailbox { [weak self] command in self?.handle(command: command) }
    }

    func stop() {
        socket?.close()
        socket = nil
        activeCommand = nil
        mailbox.setActiveSession(nil)
        sequence = 0
        audioEndMs = 0
        state = .idle
        Task { await capture.stop() }
    }

    func chooseSafariWindowAgain() {
        guard activeCommand != nil else { return }
        state = .selecting
        capture.requestNewSelection()
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
            launchAtLogin = SMAppService.mainApp.status == .enabled
        } catch {
            state = .error("无法更新登录启动设置：\(error.localizedDescription)")
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }

    private func handle(command: [String: Any]) {
        switch command["type"] as? String {
        case "start": start(command: command)
        case "stop": stop()
        default: break
        }
    }

    private func start(command: [String: Any]) {
        guard
            let sessionText = command["sessionId"] as? String,
            let sessionId = UUID(uuidString: sessionText),
            let tabId = command["tabId"] as? Int,
            let settingsObject = command["settings"],
            JSONSerialization.isValidJSONObject(settingsObject),
            let settingsData = try? JSONSerialization.data(withJSONObject: settingsObject),
            let settings = try? JSONDecoder().decode(ExtensionSettings.self, from: settingsData)
        else {
            state = .error("扩展发送的启动配置无效")
            return
        }

        stop()
        let start = StartCommand(sessionId: sessionId, tabId: tabId, settings: settings)
        activeCommand = start
        mailbox.setActiveSession(sessionId)
        state = .selecting
        capture.requestSelection()
    }

    private func forward(_ event: [String: Any]) {
        guard let activeCommand else { return }
        SFSafariApplication.dispatchMessage(
            withName: "native-event",
            toExtensionWithIdentifier: Self.extensionBundleIdentifier,
            userInfo: activeCommand.nativeEventEnvelope(event)
        ) { error in
            if let error { print("Safari event delivery failed: \(error.localizedDescription)") }
        }
    }
}

extension AppCoordinator: ScreenAudioCaptureDelegate {
    func screenAudioCaptureDidStart(_ capture: ScreenAudioCapture) {
        guard let activeCommand else { return }
        if socket == nil {
            let socket = RealtimeSocket(settings: activeCommand.settings, sessionId: activeCommand.sessionId)
            socket.delegate = self
            self.socket = socket
            socket.connect()
        }
    }

    func screenAudioCapture(_ capture: ScreenAudioCapture, didProduce pcm: Data) {
        audioEndMs &+= 40
        socket?.send(AudioFrame(sequence: sequence, audioEndMs: audioEndMs, pcm: pcm))
        sequence &+= 1
    }

    func screenAudioCapture(_ capture: ScreenAudioCapture, didFail error: Error) {
        socket?.close()
        socket = nil
        state = .error(error.localizedDescription)
        forward(["type": "error", "code": "safari_capture_failed", "message": error.localizedDescription, "retryable": false])
    }

    func screenAudioCaptureDidStop(_ capture: ScreenAudioCapture) {
        state = .error("已取消 Safari 窗口选择")
        forward(["type": "error", "code": "selection_cancelled", "message": "已取消 Safari 窗口选择", "retryable": false])
    }
}

extension AppCoordinator: RealtimeSocketDelegate {
    func realtimeSocket(_ socket: RealtimeSocket, didReceive event: [String: Any]) {
        forward(event)
    }

    func realtimeSocket(_ socket: RealtimeSocket, didChange state: HostState) {
        if case .selecting = self.state, state == .connecting { return }
        self.state = state
        if state == .reconnecting {
            forward(["type": "status", "code": "reconnecting", "message": state.label])
        }
    }
}
