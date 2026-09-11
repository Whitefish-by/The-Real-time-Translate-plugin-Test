import type { ExtensionSettings, ServerMessage } from "@live-subtitles/shared";

export type SessionSnapshot = {
  state: "idle" | "starting" | "capturing" | "reconnecting" | "error";
  sessionId?: string;
  tabId?: number;
  statusMessage: string;
  detectedLanguage?: string;
  latencyMs?: number;
  errorCode?: string;
};

export type ExtensionMessage =
  | { type: "popup:get-state" }
  | { type: "popup:state"; state: SessionSnapshot }
  | { type: "popup:start"; tabId?: number }
  | { type: "popup:stop" }
  | { type: "popup:open-options" }
  | { type: "settings:get" }
  | { type: "settings:set"; settings: ExtensionSettings }
  | { type: "settings:test"; settings: ExtensionSettings }
  | { type: "offscreen:start"; streamId: string; sessionId: string; settings: ExtensionSettings; generation: number }
  | { type: "offscreen:stop" }
  | { type: "offscreen:event"; event: ServerMessage }
  | { type: "offscreen:state"; sessionId: string; state: Pick<SessionSnapshot, "state" | "statusMessage"> }
  | { type: "content:subtitle"; event: ServerMessage; settings: ExtensionSettings }
  | { type: "content:state"; state: SessionSnapshot }
  | { type: "content:settings"; settings: ExtensionSettings }
  | { type: "safari:native-event"; event: ServerMessage };

export const IDLE_SNAPSHOT: SessionSnapshot = { state: "idle", statusMessage: "尚未开始" };
