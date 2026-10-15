import { invoke } from '@tauri-apps/api/core';
import { Book } from '@/types/book';
import { AppService } from '@/types/system';

type BookPresence = {
  bookHash: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  sessionStart: number;
};

/**
 * Get an HTTPS cover URL suitable for Discord Rich Presence.
 *
 * Discord needs a publicly reachable image URL, and the only source for one was
 * Readest's public bucket: the local cover.png was processed and uploaded to
 * serve as the presence image. A LAN build has no public bucket, so there is no
 * image to hand over — the presence still reports the book, title and author,
 * just without artwork. The local cache and its retry backoff went with the
 * upload they existed to throttle.
 */
const getCoverUrlForDiscord = async (
  _book: Book,
  _appService: AppService,
): Promise<string | undefined> => undefined;

/**
 * Update Discord Rich Presence with current book information
 */
export const updateDiscordPresence = async (
  book: Book,
  sessionStart: number,
  appService: AppService,
): Promise<void> => {
  if (!appService?.isDesktopApp) return;

  try {
    const coverUrl = await getCoverUrlForDiscord(book, appService);
    const bookPresence: BookPresence = {
      bookHash: book.hash,
      title: book.title,
      author: book.author || null,
      coverUrl: coverUrl || null,
      sessionStart,
    };

    await invoke('update_book_presence', { presence: bookPresence });
  } catch (error) {
    console.warn('Failed to update Discord presence:', error);
  }
};

/**
 * Clear Discord Rich Presence
 */
export const clearDiscordPresence = async (appService: AppService): Promise<void> => {
  if (!appService?.isDesktopApp) return;

  try {
    await invoke('clear_book_presence');
  } catch (error) {
    console.warn('Failed to clear Discord presence:', error);
  }
};
