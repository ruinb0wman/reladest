/**
 * Local book deletion.
 *
 * Upstream this lived in services/cloudService together with the whole Readest
 * storage layer (uploads, downloads, signed URLs, replica bundles). All that is
 * gone; what remains is the part that only ever touched this device:
 *
 *   - `local`  : drop this device's copy of the file, keep the row.
 *   - `both`   : drop the file and the cover, tombstone the row.
 *   - `purge`  : erase the app-generated Books/<hash>/ directory entirely —
 *                managed book file, cover, config.json (progress, notes,
 *                bookmarks) and nav.json — plus the per-book TTS cache.
 *
 * It still refuses to touch an `external` source (a book imported "in place", or
 * a transiently-opened file): deleting a book from Readest must never remove the
 * user's own file. The remote copy is the file mirror's business — a tombstoned
 * row is garbage-collected on the next sync pass.
 */
import { FileSystem, DeleteAction } from '@/types/system';
import { Book } from '@/types/book';
import { getDir, getCoverFilename } from '@/utils/book';
import { resolveBookContentSource } from './bookContent';
import { getAbsOfflineDir } from '@/utils/audiobook';

export async function deleteBook(
  fs: FileSystem,
  book: Book,
  deleteAction: DeleteAction,
): Promise<void> {
  if (deleteAction === 'local' || deleteAction === 'both' || deleteAction === 'purge') {
    const source = await resolveBookContentSource(fs, book);
    // Only remove files Readest itself created. A 'managed' source lives under
    // our Books/<hash>/ dir (a copy we made on import), so it is ours to delete.
    // An 'external' source is the user's own file at a user-controlled location
    // (book.filePath, base 'None') — e.g. a "Read books in place" import or a
    // transiently-opened file. Deleting a book from Readest must NEVER remove
    // that source file; doing so silently destroyed users' originals.
    if (source.kind === 'managed' && deleteAction !== 'purge') {
      // Purge wipes the whole directory below, so skip the per-file removal.
      if (await fs.exists(source.path, source.base)) {
        await fs.removeFile(source.path, source.base);
      }
    }

    // Purge erases the entire app-generated Books/<hash>/ directory — the
    // managed book file, cover.png, and (the reason for issue #4615)
    // config.json (reading progress, notes, bookmarks) + nav.json that the
    // other delete actions leave behind. In-place books keep their external
    // source file untouched; this only clears Readest's own sidecar dir.
    if (deleteAction === 'purge') {
      const dir = getDir(book);
      if (await fs.exists(dir, 'Books')) {
        await fs.removeDir(dir, 'Books', true);
      }
      // The per-book TTS audio cache lives under Cache (kept out of Books/
      // so backups and sync never pick it up); purge erases every trace of
      // the book, so drop it too. Non-purge deletes leave it: like
      // config.json, a re-downloaded book resumes with a warm audio cache.
      const ttsCacheDir = `tts-cache/${book.hash}`;
      if (await fs.exists(ttsCacheDir, 'Cache')) {
        await fs.removeDir(ttsCacheDir, 'Cache', true);
      }
    }

    // An offline Audiobookshelf download keeps its tracks beside the book
    // (#6256); purge already wiped the whole directory above.
    if (book.format === 'ABS' && deleteAction !== 'purge') {
      const offlineDir = getAbsOfflineDir(book.hash);
      if (await fs.exists(offlineDir, 'Books')) {
        await fs.removeDir(offlineDir, 'Books', true);
      }
    }
    book.absDownloadedAt = null;

    if (deleteAction === 'both' && (await fs.exists(getCoverFilename(book), 'Books'))) {
      await fs.removeFile(getCoverFilename(book), 'Books');
    }
    if (deleteAction === 'local' || deleteAction === 'purge') {
      // Mirror 'local': mark not-downloaded but leave the tombstone (deletedAt)
      // to the caller. The page's handleBookDelete sets deletedAt and queues the
      // cloud deletion for purge, exactly as it does for the 'both' action.
      book.downloadedAt = null;
    } else {
      book.deletedAt = Date.now();
      book.downloadedAt = null;
      book.coverDownloadedAt = null;
    }
  }
}
