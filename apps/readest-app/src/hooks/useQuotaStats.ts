import { useMemo } from 'react';
import type { QuotaType, UserPlan } from '@/types/quota';
import { isSelfHosted } from '@/utils/access';

/**
 * Entitlements in a LAN/self-hosted build.
 *
 * Upstream resolved the plan from the auth JWT and metered two quotas
 * (Readest Cloud storage bytes, daily translation characters) against a
 * per-plan allowance, caching the plan for the non-React gate checks in the
 * transfer manager and the sync-category resolver.
 *
 * None of that exists here: there is no account, no control plane and no
 * plan to be on. `isSelfHosted()` unlocks every premium gate outright, so the
 * honest return is "unrestricted" — and it is reported as a settled value
 * (`'pro'`, not `undefined`) because callers use `undefined` to mean "the plan
 * is still loading" and would otherwise wait forever. Quotas are empty rather
 * than fabricated so no surface renders a usage bar it cannot compute.
 *
 * Kept as a hook with the same shape so the ~9 call sites stay untouched.
 */
export const useQuotaStats = (_briefName = false) => {
  return useMemo(
    () => ({
      quotas: [] as QuotaType[],
      // The most permissive plan value: every gate below it is already open in
      // a self-hosted build, and this keeps "still loading" out of the UI.
      userProfilePlan: 'pro' as UserPlan,
      customizationPurchased: false,
    }),
    [],
  );
};

/** True when the running deployment unlocks premium features for everyone. */
export const isUnmeteredBuild = (): boolean => isSelfHosted();
