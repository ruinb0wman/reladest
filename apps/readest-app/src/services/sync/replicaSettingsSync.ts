import type { SystemSettings } from '@/types/settings';

/**
 * Settings replica sync — removed with Readest Cloud.
 *
 * The kernel that shipped only in this build (the LAN profile) is the file-sync
 * one; settings are not pushed anywhere. These stay as no-ops for the two call
 * sites that remain (Providers' boot hook and the dictionary store's provider
 * ordering) so the LAN build keeps its shape without a cloud sync client.
 */
export const initSettingsSync = (_initialSettings?: SystemSettings): void => {};

/** Was: force the next settings push so provider order wins. Now a no-op. */
export const markExplicitProviderOrderPublish = (): void => {};

/** Was: push the settings file when its fingerprint changed. Now a no-op. */
export const publishSettingsIfChanged = async (_settings: SystemSettings): Promise<void> => {};

/** Was: apply a remote settings patch. Now: nothing to apply. */
export const applyRemoteSettings = (_envConfig: unknown, _record: unknown): void => {};

export const clearStoredEncryptedHashes = (_paths: readonly string[]): void => {};

export const getStoredLastSeenCipher = (): Record<string, string> => ({});

export const __resetSettingsSyncForTests = (): void => {};
