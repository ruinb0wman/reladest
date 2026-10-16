import { useEffect } from 'react';
import { addPluginListener, type PluginListener } from '@tauri-apps/api/core';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { refreshBookshelfWidget } from '@/services/widget/bookshelfWidget';
import { refreshReadingWidget } from '@/services/widget/readingWidget';
import { debounce } from '@/utils/debounce';
import { useTranslation } from './useTranslation';

/**
 * Publish the home-screen widget snapshots (Bookshelf and Currently Reading).
 * The widgets are only visible while the app is backgrounded, so we publish
 * (1) once the library is loaded, (2) whenever the app goes to the background,
 * and (3) when a widget is placed or reconfigured while the app is running.
 * Mounted on both the library and reader pages. Each refresh is coalesced
 * independently, so one never blocks the other.
 *
 * TTS playback used to drive two more refresh paths (state changes and throttled
 * position ticks) so the widget could show play/pause and live progress.
 */
export function useHomeScreenWidgets() {
  const _ = useTranslation();
  const { appService } = useEnv();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  useEffect(() => {
    if (!appService?.isMobileApp) return;

    const publishNow = () => {
      void refreshBookshelfWidget(appService, _);
      void refreshReadingWidget(appService, _);
    };

    const publish = debounce(publishNow, 500);

    if (libraryLoaded) publish();

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // Flush now: the WebView may be suspended before a debounced timer
        // fires, and backgrounding is exactly when the widgets need the
        // latest reading progress.
        publish();
        publish.flush();
      }
    };

    let configuredListener: PluginListener | undefined;
    let unmounted = false;
    if (appService.isAndroidApp) {
      addPluginListener('native-bridge', 'bookshelf-widget-configured', publishNow)
        .then((listener) => {
          if (unmounted) void listener.unregister();
          else configuredListener = listener;
        })
        .catch((err) => console.warn('Failed to listen for widget configuration', err));
    }

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unmounted = true;
      void configuredListener?.unregister();
      document.removeEventListener('visibilitychange', onVisibility);
      publish.cancel();
    };
  }, [appService, libraryLoaded, _]);
}
