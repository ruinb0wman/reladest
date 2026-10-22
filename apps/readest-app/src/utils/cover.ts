import { Book } from '@/types/book';
import { AppService } from '@/types/system';

/**
 * True when the URL is fetchable by external services (markdown
 * readers), i.e. not a local dev server or the Tauri asset protocol.
 */
export const isPublicImageUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

/**
 * Resolve a publicly accessible cover image URL for the book, or undefined when
 * none can be provided. A public `coverImageUrl` from the book metadata is used
 * as-is; there is no second source any more.
 *
 * The local cover.png used to be published to Readest's public bucket
 * (`media/book_covers/<user-seg>/<coverHash>.png`, served via
 * assets.readest.com) so external services — Discord, an
 * exported markdown file — could fetch it. A LAN build has no public bucket to
 * publish to and no account to own the object, so books without a public
 * `coverImageUrl` simply have no public cover. Every caller already treats
 * `undefined` as "no cover to attach" rather than an error.
 */
export const getPublicCoverUrl = async (
  book: Book,
  _appService: AppService | null,
): Promise<string | undefined> => {
  if (isPublicImageUrl(book.coverImageUrl)) return book.coverImageUrl;
  return undefined;
};
