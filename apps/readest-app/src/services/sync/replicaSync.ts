/**
 * Replica sync context — removed with Readest Cloud.
 *
 * `getReplicaSync()` returning null is exactly the state this build ran in
 * before the layer was deleted (no signed-in user, no init), and every consumer
 * already guards on it, so the shell keeps them inert without touching them.
 */
export interface ReplicaSyncInitOpts {
  deviceId: string;
  [key: string]: unknown;
}

export interface ReplicaSyncContext {
  deviceId: string;
  [key: string]: unknown;
}

export const subscribeReplicaSyncReady =
  (_listener: () => void): (() => void) =>
  () => {};

export const initReplicaSync = (opts: ReplicaSyncInitOpts): ReplicaSyncContext => ({
  deviceId: opts.deviceId,
});

export const getReplicaSync = (): ReplicaSyncContext | null => null;

export const isReplicaSyncReady = (): boolean => false;

export const __resetReplicaSyncForTests = (): void => {};
