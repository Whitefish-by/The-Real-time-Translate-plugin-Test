import { DEFAULT_SETTINGS, extensionSettingsSchema, type ExtensionSettings } from "./protocol";

export function parseSettings(input: unknown): ExtensionSettings {
  const candidate = typeof input === "object" && input !== null ? { ...DEFAULT_SETTINGS, ...input } : DEFAULT_SETTINGS;
  const parsed = extensionSettingsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS, sourceLanguages: [...DEFAULT_SETTINGS.sourceLanguages] };
}
