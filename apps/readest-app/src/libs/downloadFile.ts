/**
 * Download a file over HTTP(S), writing it through the platform's own writer:
 * a Blob + AppService on web, the native downloader on Tauri (which streams to
 * disk with progress and its own TLS handling).
 *
 * Upstream this lived in a `libs/storage` module that also spoke to Readest's
 * object storage — uploads, signed URLs, listings, purge — and could mint a
 * download URL from a cloud key. All of that is gone; what is left is the
 * generic downloader, used by OPDS (covers, automatic downloads), WordLens gloss
 * packs and the Audiobookshelf offline cache.
 */
import { isWebAppPlatform } from '@/services/environment';
import { AppService } from '@/types/system';
import { tauriDownload, webDownload, ProgressHandler } from '@/utils/transfer';

export type DownloadFileParams = {
  appService: AppService;
  dst: string;
  url: string;
  headers?: Record<string, string>;
  singleThreaded?: boolean;
  skipSslVerification?: boolean;
  onProgress?: ProgressHandler;
};

export const downloadFile = async ({
  appService,
  dst,
  url,
  headers,
  singleThreaded,
  skipSslVerification,
  onProgress,
}: DownloadFileParams) => {
  try {
    if (!url) {
      // A download needs somewhere to download from. Deriving one from a cloud
      // object key (`<user>/<cfp>`) was the Readest storage path.
      throw new Error(`No download URL for '${dst}'`);
    }
    const downloadUrl = url;

    if (isWebAppPlatform()) {
      const { headers: responseHeaders, blob } = await webDownload(
        downloadUrl,
        onProgress,
        headers,
      );
      await appService.writeFile(dst, 'None', await blob.arrayBuffer());
      return responseHeaders;
    } else {
      return await tauriDownload(
        downloadUrl,
        dst,
        onProgress,
        headers,
        undefined,
        singleThreaded,
        skipSslVerification,
      );
    }
  } catch (error) {
    console.error(`File '${dst}' download failed:`, error);
    throw error;
  }
};
