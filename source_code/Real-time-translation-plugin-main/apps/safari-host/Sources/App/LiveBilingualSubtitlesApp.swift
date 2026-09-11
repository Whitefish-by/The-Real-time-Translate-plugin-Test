import AppKit
import SwiftUI

@main
struct LiveBilingualSubtitlesApp: App {
    @StateObject private var coordinator = AppCoordinator()

    var body: some Scene {
        MenuBarExtra("实时双语字幕", systemImage: coordinator.state == .capturing ? "captions.bubble.fill" : "captions.bubble") {
            VStack(alignment: .leading, spacing: 10) {
                Label(coordinator.state.label, systemImage: stateIcon)
                Divider()
                Button("重新选择 Safari 窗口") { coordinator.chooseSafariWindowAgain() }
                    .disabled(coordinator.state == .idle)
                Button("停止字幕") { coordinator.stop() }
                    .disabled(coordinator.state == .idle)
                Toggle("登录时启动", isOn: Binding(
                    get: { coordinator.launchAtLogin },
                    set: { coordinator.setLaunchAtLogin($0) }
                ))
                Divider()
                Button("退出") { NSApplication.shared.terminate(nil) }
            }
            .padding(10)
            .frame(width: 280)
        }
        .menuBarExtraStyle(.window)
    }

    private var stateIcon: String {
        switch coordinator.state {
        case .capturing: return "waveform.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        case .reconnecting, .connecting: return "arrow.triangle.2.circlepath"
        case .selecting: return "macwindow.badge.plus"
        case .idle: return "pause.circle"
        }
    }
}
