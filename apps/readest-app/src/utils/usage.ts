/**
 * Usage metering for the metered cloud engines (Readest Voice TTS, DeepL).
 *
 * Upstream counted characters per user in the control-plane Postgres
 * (`increment_daily_usage` / `get_current_usage` RPCs). A LAN build has no
 * control plane and no accounts, so there is nothing to count against: this
 * keeps the two call sites in the TTS and DeepL routes compiling and reports
 * "no usage accumulated", which is the truth for a self-hosted deployment.
 *
 * The metered engines themselves go away with the TTS and translation
 * removals; until then, this is deliberately a no-op rather than a local
 * counter, because a local counter would still need a quota to compare with.
 */

export const USAGE_TYPES = {
  TRANSLATION_CHARS: 'translation_chars',
  TTS_CHARS: 'tts_chars',
} as const;

export const QUOTA_TYPES = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
} as const;

export class UsageStatsManager {
  static async trackUsage(
    _userId: string,
    _usageType: string,
    _increment = 1,
    _metadata: Record<string, string | number> = {},
  ): Promise<number> {
    return 0;
  }

  static async getCurrentUsage(
    _userId: string,
    _usageType: string,
    _period: 'daily' | 'monthly' = 'daily',
  ): Promise<number> {
    return 0;
  }
}
