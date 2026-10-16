import { describe, it, expect, vi, afterEach } from 'vitest';
import { isCustomizationAllowed, isSelfHosted } from '@/utils/access';

describe('isCustomizationAllowed', () => {
  it('allows an explicit purchase on any plan', () => {
    expect(isCustomizationAllowed('free', true)).toBe(true);
  });

  it('allows subscription tiers without a separate purchase', () => {
    expect(isCustomizationAllowed('plus', false)).toBe(true);
    expect(isCustomizationAllowed('pro', false)).toBe(true);
  });

  // `getUserProfilePlan` reports 'purchase' for anyone holding ANY one-time
  // purchase, which is how a storage add-on presents. Treating that as
  // entitlement would hand Full Customization to every storage buyer.
  it('does not treat a storage-only buyer as entitled', () => {
    expect(isCustomizationAllowed('purchase', false)).toBe(false);
  });

  it('denies a free user who has not bought it', () => {
    expect(isCustomizationAllowed('free', false)).toBe(false);
  });
});

// A self-hosted deployment has no store to buy from, and the operator already
// runs the infrastructure the paywall funds, so everything is unlocked.
describe('self-hosted deployments', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default', () => {
    expect(isSelfHosted()).toBe(false);
  });

  it('unlocks premium for a signed-in free user with no purchase', () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  it('unlocks premium with no login at all, where the plan reads free', () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  // `??` stops at an empty string, so a blank SELF_HOSTED would mask the
  // public variable and silently re-lock a self-hosted deployment.
  it('falls through an explicitly empty SELF_HOSTED', () => {
    vi.stubEnv('SELF_HOSTED', '');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isSelfHosted()).toBe(true);
  });
});

// Custom translators (the user's own LLM endpoint or DeepL key) are premium.
// The reader decides from the session token alone, so a signed-out reader is
// locked unless the deployment is self-hosted.
