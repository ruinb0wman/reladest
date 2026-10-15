/**
 * Binary (font / dictionary / texture) replica transfers — removed with the
 * cloud sync layer. Kept as no-ops for the call sites that queue an upload right
 * after writing a file locally.
 *
 * The record shape mirrors what the adapters used to require (an id-bearing row
 * with a display name), which is what every caller already passes.
 */
interface ReplicaBinaryRecord {
  contentId?: string;
  name: string;
  reincarnation?: string;
}
export const queueReplicaBinaryUpload = async <T extends ReplicaBinaryRecord>(
  _kind: string,
  _record: T,
  _appService?: unknown,
): Promise<void> => {};

export const queueReplicaBinaryDownload = async <T extends ReplicaBinaryRecord>(
  _kind: string,
  _record: T,
  _appService?: unknown,
): Promise<void> => {};

export const queueReplicaBinaryDelete = async <T extends ReplicaBinaryRecord>(
  _kind: string,
  _record: T,
): Promise<void> => {};

export const queueDictionaryBinaryUpload = async <T extends ReplicaBinaryRecord>(
  _record: T,
  _appService?: unknown,
): Promise<string | null> => null;
