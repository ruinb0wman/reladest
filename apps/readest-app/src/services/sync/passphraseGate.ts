/**
 * Cloud-encryption passphrase gate — removed with Readest Cloud.
 *
 * The passphrase used to unlock the E2E-encrypted replica (settings, credentials,
 * dictionaries). Nothing is encrypted on this device any more, so "unlocked" is
 * always true; the OPDS catalog manager's pre-write check therefore passes, and
 * the prompt component that used to ask for it is gone.
 */
export type PassphrasePromptKind = 'unlock' | 'setup';

export interface PassphrasePromptRequest {
  kind: PassphrasePromptKind;
  [key: string]: unknown;
}

export type PassphrasePrompter = (req: PassphrasePromptRequest) => Promise<string | null>;

export const setPassphrasePrompter = (_p: PassphrasePrompter | null): void => {};

export const setPassphraseDismisser = (_d: (() => void) | null): void => {};

export const ensurePassphraseUnlocked = async (_deps: unknown = {}): Promise<void> => {};

export const __resetPassphraseGateForTests = (): void => {};
