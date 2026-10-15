/**
 * Cloud replica publishing — removed for the LAN build.
 *
 * Every replica-aware store still calls these after a local mutation (that is
 * how upstream couples "the row changed" with "tell the cloud"), so they stay as
 * no-ops rather than forcing an edit into ~20 stores. Local persistence is
 * unaffected: stores save through `saveCustom*` / `saveLibraryBooks`, and the
 * `getReplicaPersistEnv()` gate they use lives in `./replicaPersist`.
 *
 * Before deletion these calls already returned early in this build (no sync
 * context, no signed-in user), so behaviour is unchanged.
 */
export const publishReplicaUpsert = async <T>(
  _kind: string,
  _record: T,
  _contentId: string,
  _reincarnation?: string,
): Promise<void> => {};

export const publishReplicaDelete = async (_kind: string, _contentId: string): Promise<void> => {};
