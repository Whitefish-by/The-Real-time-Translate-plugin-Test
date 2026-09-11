import { DEFAULT_SETTINGS, extensionSettingsSchema, parseSettings, type ExtensionSettings } from "@live-subtitles/shared";

const KEY = "extensionSettings";

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(KEY);
  return parseSettings(result[KEY]);
}

export async function setSettings(settings: ExtensionSettings): Promise<void> {
  const parsed = extensionSettingsSchema.parse(settings);
  await chrome.storage.local.set({ [KEY]: parsed });
}

export async function ensureSettings(): Promise<void> {
  const result = await chrome.storage.local.get(KEY);
  if (!result[KEY]) await chrome.storage.local.set({ [KEY]: DEFAULT_SETTINGS });
}
