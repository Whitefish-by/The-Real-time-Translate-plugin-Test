import Foundation

@MainActor
protocol RealtimeSocketDelegate: AnyObject {
    func realtimeSocket(_ socket: RealtimeSocket, didReceive event: [String: Any])
    func realtimeSocket(_ socket: RealtimeSocket, didChange state: HostState)
}

@MainActor
final class RealtimeSocket {
    weak var delegate: RealtimeSocketDelegate?

    private let settings: ExtensionSettings
    private let sessionId: UUID
    private var generation = 0
    private var task: URLSessionWebSocketTask?
    private var pending: [AudioFrame] = []
    private var manuallyClosed = false
    private var ready = false
    private var sending = false
    private var droppedAudio = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private let retryDelays: [UInt64] = [100, 250, 500, 1_000, 2_000]

    init(settings: ExtensionSettings, sessionId: UUID) {
        self.settings = settings
        self.sessionId = sessionId
    }

    func connect() {
        manuallyClosed = false
        openSocket()
    }

    func send(_ frame: AudioFrame) {
        if !pending.contains(where: { $0.sequence == frame.sequence }) {
            pending.append(frame)
        }
        while let first = pending.first, frame.audioEndMs > first.audioEndMs + 2_000 {
            pending.removeFirst()
            droppedAudio = true
        }
        drainPending()
    }

    func close() {
        manuallyClosed = true
        reconnectTask?.cancel()
        let closingTask = task
        task = nil
        if let closingTask {
            let end: [String: Any] = ["type": "end", "sessionId": sessionId.uuidString.lowercased()]
            if let data = try? JSONSerialization.data(withJSONObject: end), let text = String(data: data, encoding: .utf8) {
                Task {
                    try? await closingTask.send(.string(text))
                    closingTask.cancel(with: .normalClosure, reason: nil)
                }
            } else {
                closingTask.cancel(with: .normalClosure, reason: nil)
            }
        }
        pending.removeAll(keepingCapacity: false)
        ready = false
        sending = false
    }

    private func openSocket() {
        guard let url = URL(string: settings.gatewayUrl) else {
            delegate?.realtimeSocket(self, didChange: .error("网关地址无效"))
            return
        }
        delegate?.realtimeSocket(self, didChange: reconnectAttempt == 0 ? .connecting : .reconnecting)
        let task = URLSession.shared.webSocketTask(with: url)
        self.task = task
        task.resume()
        sendHello(on: task)
        receive(on: task)
    }

    private func sendHello(on task: URLSessionWebSocketTask) {
        let hello: [String: Any] = [
            "type": "hello",
            "protocolVersion": 1,
            "token": settings.clientToken,
            "sessionId": sessionId.uuidString.lowercased(),
            "generation": generation,
            "sourceLanguages": settings.sourceLanguages,
            "targetLanguage": settings.targetLanguage,
            "audio": ["encoding": "pcm_s16le", "sampleRate": 16_000, "channels": 1, "frameDurationMs": 40]
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: hello),
            let text = String(data: data, encoding: .utf8)
        else { return }
        Task { [weak self] in
            do { try await task.send(.string(text)) }
            catch {
                await MainActor.run {
                    guard task === self?.task else { return }
                    self?.handleDisconnect()
                }
            }
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        Task { [weak self] in
            do {
                let message = try await task.receive()
                let data: Data
                switch message {
                case .string(let text): data = Data(text.utf8)
                case .data(let value): data = value
                @unknown default: return
                }
                if let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    await MainActor.run { self?.handle(event: event, task: task) }
                } else {
                    await MainActor.run {
                        guard task === self?.task, let self else { return }
                        self.handle(event: [
                            "type": "error",
                            "sessionId": self.sessionId.uuidString.lowercased(),
                            "code": "invalid_server_message",
                            "message": "网关返回了无效消息",
                            "retryable": false
                        ], task: task)
                    }
                }
            } catch {
                await MainActor.run {
                    guard task === self?.task else { return }
                    self?.handleDisconnect()
                }
            }
        }
    }

    private func handle(event: [String: Any], task: URLSessionWebSocketTask) {
        guard task === self.task else { return }
        if event["type"] as? String == "ready" {
            ready = true
            reconnectAttempt = 0
            delegate?.realtimeSocket(self, didChange: .capturing)
            if droppedAudio {
                droppedAudio = false
                delegate?.realtimeSocket(self, didReceive: [
                    "type": "status",
                    "sessionId": sessionId.uuidString.lowercased(),
                    "code": "audio_gap",
                    "message": "重连缓存已达 2 秒，部分字幕可能缺失"
                ])
            }
            drainPending()
        }
        if event["type"] as? String == "error", event["retryable"] as? Bool == false {
            manuallyClosed = true
            ready = false
            pending.removeAll(keepingCapacity: false)
            self.task = nil
            task.cancel(with: .policyViolation, reason: nil)
            delegate?.realtimeSocket(self, didChange: .error(event["message"] as? String ?? "字幕网关错误"))
        }
        delegate?.realtimeSocket(self, didReceive: event)
        if !manuallyClosed { receive(on: task) }
    }

    private func drainPending() {
        guard ready, !sending, let task, let frame = pending.first else { return }
        sending = true
        Task { [weak self] in
            do {
                try await task.send(.data(frame.encoded))
                await MainActor.run { self?.completeSend(frame: frame, task: task, failed: false) }
            } catch {
                await MainActor.run { self?.completeSend(frame: frame, task: task, failed: true) }
            }
        }
    }

    private func completeSend(frame: AudioFrame, task: URLSessionWebSocketTask, failed: Bool) {
        guard task === self.task else { return }
        sending = false
        if failed {
            handleDisconnect()
            return
        }
        if pending.first?.sequence == frame.sequence { pending.removeFirst() }
        drainPending()
    }

    private func handleDisconnect() {
        guard !manuallyClosed, reconnectTask == nil else { return }
        ready = false
        sending = false
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        delegate?.realtimeSocket(self, didChange: .reconnecting)
        let index = min(reconnectAttempt, retryDelays.count - 1)
        let delay = retryDelays[index]
        reconnectAttempt += 1
        generation += 1
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(delay))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.reconnectTask = nil
                self?.openSocket()
            }
        }
    }
}
