import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { EnvConfigType, isWebAppPlatform } from '@/services/environment';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookWithUpdatedMetadata } from '@/utils/book';

/**
 * Saves a Book Details metadata edit, from the library or from inside the
 * reader (#6584). The edit applies to the library's entry for the book, which
 * is fresher than the snapshot a reader took when it opened, and also
 * refreshes that snapshot so an open reader shows the edit.
 */
export const saveBookMetadataEdit = async (
  envConfig: EnvConfigType,
  book: Book,
  metadata: BookMetadata,
  tags: string[],
) => {
  const appService = await envConfig.getAppService();
  const { library, hashIndex, updateBook } = useLibraryStore.getState();
  const idx = hashIndex.get(book.hash);
  const current = idx !== undefined ? library[idx]! : book;
  // Build a NEW book object instead of mutating `book` in place. <BookCover>
  // is memoized and compares fields off the book, so mutating the existing
  // object (which React holds as the previous snapshot) makes the comparator
  // see no change and the library cover only refreshes after a full reload.
  const updatedBook = getBookWithUpdatedMetadata(current, metadata, tags);
  if (metadata.coverImageBlobUrl || metadata.coverImageUrl || metadata.coverImageFile) {
    try {
      await appService.updateCoverImage(
        updatedBook,
        metadata.coverImageBlobUrl || metadata.coverImageUrl,
        metadata.coverImageFile,
      );
      // Cover-change sync (issue #4544): recompute the cover's content hash.
      // If it actually changed, bump coverHash + coverUpdatedAt so peers
      // re-download it (the book row already syncs via metadataUpdatedAt).
      // computeCoverHash returns null for a '_blank' deletion — we skip the
      // bump there (cover deletion is intentionally not synced; peers keep
      // their cover until a new one is set).
      const newCoverHash = await appService.computeCoverHash(updatedBook);
      if (newCoverHash && newCoverHash !== current.coverHash) {
        // Announcing the new hash is the whole job now: the cover file itself
        // reaches peers through the file mirror's next pass. Upstream this had
        // to re-upload the cover to Readest storage FIRST (or peers would fetch
        // a cover that was not there yet).
        updatedBook.coverHash = newCoverHash;
        updatedBook.coverUpdatedAt = Date.now();
      }
    } catch (error) {
      console.warn('Failed to update cover image:', error);
    }
  }
  if (isWebAppPlatform()) {
    // Clear HTTP cover image URL if cover is updated with a local file
    if (metadata.coverImageBlobUrl) {
      metadata.coverImageUrl = undefined;
    }
  } else {
    metadata.coverImageUrl = undefined;
  }
  metadata.coverImageBlobUrl = undefined;
  metadata.coverImageFile = undefined;
  await updateBook(envConfig, updatedBook);

  useBookDataStore.setState((state) => {
    const bookData = state.booksData[book.hash];
    if (!bookData?.book) return state;
    return {
      booksData: {
        ...state.booksData,
        [book.hash]: { ...bookData, book: { ...bookData.book, ...updatedBook } },
      },
    };
  });
};
