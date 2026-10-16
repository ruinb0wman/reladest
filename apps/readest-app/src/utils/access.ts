import { UserPlan } from '@/types/quota';
import { getRuntimeConfig } from '@/services/runtimeConfig';

export const isCloudSyncInPlan = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isCustomizationAllowed(plan, customizationPurchased);

/**
 * Master switch for the third-party cloud-sync premium paywall. ON: cloud
 * sync (WebDAV / Google Drive / S3) requires a {@link CLOUD_SYNC_PLANS} plan —
 * free users see the provider rows with a Premium badge and an upgrade route
 * instead of the config sub-pages, and a downgraded account's still-selected
 * provider is paused (never a silent fallback to Readest Cloud uploads, #4959).
 * Every gate goes through {@link isCloudSyncAllowed}, so this flag is the
 * whole toggle.
 */
export const CLOUD_SYNC_REQUIRES_PREMIUM = true;

/**
 * Whether third-party cloud sync is available for a plan. Falls back to the
 * {@link isCloudSyncInPlan} paywall while {@link CLOUD_SYNC_REQUIRES_PREMIUM}
 * is on; flipping the switch off ungates every plan.
 */
export const isCloudSyncAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  !CLOUD_SYNC_REQUIRES_PREMIUM || isCloudSyncInPlan(plan, customizationPurchased);

export const isNearbyPairingInPlan = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isCustomizationAllowed(plan, customizationPurchased);

/**
 * Master switch for the pairing paywall, mirroring
 * {@link CLOUD_SYNC_REQUIRES_PREMIUM}. ON: pairing (and therefore
 * confirmation-free drops) requires a {@link NEARBY_PAIRING_PLANS} plan.
 * Flipping it off ungates every plan. Existing pairing records always
 * persist; only the auto-accept behavior is gated.
 */
export const NEARBY_PAIRING_REQUIRES_PREMIUM = true;

export const isNearbyPairingAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  !NEARBY_PAIRING_REQUIRES_PREMIUM || isNearbyPairingInPlan(plan, customizationPurchased);

/**
 * Plans that carry the premium feature set without a separate purchase.
 *
 * `purchase` is deliberately absent. {@link getUserProfilePlan} reports it for
 * anyone holding ANY one-time purchase, which is how a storage add-on
 * presents, so including it would hand every premium feature to a buyer who
 * only wanted more space.
 */
export const PREMIUM_PLANS: readonly UserPlan[] = ['plus', 'pro'];

/**
 * Self-hosted deployments unlock every premium feature, signed in or not.
 * There is no store to buy from, and the operator already runs the
 * infrastructure the paywall exists to fund. Read from the runtime config in
 * the browser, and straight from the environment on the server where the
 * window-injected config does not exist.
 */
export const isSelfHosted = (): boolean =>
  getRuntimeConfig()?.selfHosted === true ||
  // `??` would stop at an empty string, so an explicitly blank SELF_HOSTED
  // would mask NEXT_PUBLIC_SELF_HOSTED. `||` falls through on empty too.
  (process.env['SELF_HOSTED'] || process.env['NEXT_PUBLIC_SELF_HOSTED']) === 'true';

/**
 * The single gate for premium features: a self-hosted deployment, a paid
 * subscription, or the Full Customization unlock bought outright.
 */
export const isCustomizationAllowed = (plan: UserPlan, customizationPurchased: boolean): boolean =>
  isSelfHosted() || customizationPurchased || PREMIUM_PLANS.includes(plan);

/**
 * LAN/self-hosted: there is no session to read anywhere. `localStorage` is kept
 * only so a stray `token` key left by an earlier build cannot be mistaken for a
 * live session; nothing writes it any more (see AuthContext).
 */
export const getAccessToken = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token') ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;
  const user = localStorage.getItem('user') ?? '{}';
  return JSON.parse(user).id ?? null;
};

/**
 * LAN/self-hosted builds have no accounts, so there is no token to validate:
 * every caller is anonymous and the API routes that require a user reject the
 * request (they are unreachable from the UI, which no longer signs in). Kept as
 * a function so the remaining routes keep compiling until they are deleted with
 * the rest of the cloud surface.
 */
export const validateUserAndToken = async (
  _authHeader: string | null | undefined,
): Promise<{ user?: { id: string; email?: string }; token?: string }> => {
  return {};
};
